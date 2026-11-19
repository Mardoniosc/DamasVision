import { Component } from '@angular/core';
import { PagePlaceholderComponent } from '../../shared/components/page-placeholder/page-placeholder.component';

@Component({
  selector: 'app-calibration-page',
  imports: [PagePlaceholderComponent],
  template: `
    <app-page-placeholder
      heading="Calibração"
      description="Marcação dos quatro cantos do tabuleiro e normalização da perspectiva."
      epic="E2 — Calibração"
    />
  `,
})
export class CalibrationPageComponent {}
