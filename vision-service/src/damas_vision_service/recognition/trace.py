"""pt-BR explanation of a square's classification (`square-trace.ts` `explainSquare`).

Built from the trace's own numbers and the thresholds used, so the text shown is the
decision taken. Kept identical to the browser's text (parity tests compare them).
"""

from __future__ import annotations

from typing import Any

from ..geometry.board import square_name
from ..jsmath import js_round, to_fixed
from .config import ClassifierConfig

PIECE_TEXT = {
    "EMPTY": "Vazia",
    "WHITE": "Branca",
    "BLACK": "Preta",
    "WHITE_KING": "Dama branca",
    "BLACK_KING": "Dama preta",
    "UNKNOWN": "Desconhecida",
}


def pct(value: float) -> str:
    return f"{js_round(value * 100)}%"


def num(value: float) -> str:
    return to_fixed(value, 2)


def explain_square(trace: dict[str, Any], config: ClassifierConfig) -> str:
    shape, color = config.shape, config.color
    f = trace["features"]
    head = f"{square_name(trace['squareIndex'])} — {PIECE_TEXT[trace['piece']]} ({pct(trace['confidence'])})"
    occupancy = (
        f"{pct(f['foregroundRatio'])} da região central difere do fundo "
        f"(vazia ≤ {pct(shape.emptyMaxRatio)}, ocupada ≥ {pct(shape.presenceMinRatio)})"
    )
    shadow = (
        f"; {pct(f['shadowRatio'])} descartado como sombra/reflexo" if f["shadowRatio"] > 0.05 else ""
    )
    texts = {
        "EMPTY_BACKGROUND": f"casa vazia: {occupancy}{shadow}",
        "OCCUPIED_FOREGROUND": f"ocupada: {occupancy}",
        "PARTIAL_OCCUPANCY": f"ocupação parcial — peça fora do centro, mão ou cantos desalinhados: {occupancy}",
        "NOT_PIECE_SHAPED": (
            f"algo cobre o centro mas não tem forma de peça (só {pct(f['ringForegroundRatio'])} "
            f"da borda do disco; peça ≥ {pct(shape.occupancyRingMinRatio)}) — reflexo, dedo ou objeto"
        ),
        "ROI_OBSTRUCTED": (
            "nenhum canto da casa se parece com o tabuleiro — região obstruída (mão, objeto) "
            "ou calibração deslocada"
        ),
        "LOW_BOARD_CONTRAST": (
            f"a casa é escura demais ({num(f['backgroundRelative'])} da luz local, mínimo "
            f"{num(color.darkSquareMinRelativeLuminance)}) para distinguir uma peça preta"
        ),
        "WHITE_CONTRAST": (
            f"peça mais clara que a casa: razão {num(f['contrastRatio'])} "
            f"(branca ≥ {num(color.whiteMinContrastRatio)})"
        ),
        "BLACK_CONTRAST": (
            f"peça mais escura que a casa: razão {num(f['contrastRatio'])} "
            f"(preta ≤ {num(color.blackMaxContrastRatio)})"
        ),
        "AMBIGUOUS_COLOR": (
            f"cor ambígua: razão peça/casa {num(f['contrastRatio'])} entre "
            f"{num(color.blackMaxContrastRatio)} e {num(color.whiteMinContrastRatio)}"
        ),
        "INCONSISTENT_PIECE_COLOR": (
            f"a cor do \"corpo\" (RGB {','.join(str(v) for v in f['bodyColor'])}) difere das demais "
            "peças claras — provável mão ou objeto, não uma peça"
        ),
        "NO_MARK": (
            f"sem marca colorida no topo da peça: {pct(f['markCoverage'])} da área de marca "
            f"esperada (dama ≥ {pct(color.kingMarkMinCoverage)})"
        ),
        "COLORED_MARK": (
            f"marca colorida de dama no topo da peça: {pct(f['markCoverage'])} da área esperada "
            f"(≥ {pct(color.kingMarkMinCoverage)})"
        ),
        "AMBIGUOUS_MARK": (
            f"marca de dama ambígua: {pct(f['markCoverage'])} da área esperada, perto do limite "
            f"{pct(color.kingMarkMinCoverage)}"
        ),
    }
    visible = trace["roi"]["visibleCorners"]
    roi = f" Fundo medido em {visible} de 4 cantos." if 0 < visible < 4 else ""
    return f"{head}: {texts[trace['reason']]}.{roi}"
