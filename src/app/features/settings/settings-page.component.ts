import { Component } from '@angular/core';
import { PagePlaceholderComponent } from '../../shared/components/page-placeholder/page-placeholder.component';

@Component({
  selector: 'app-settings-page',
  imports: [PagePlaceholderComponent],
  template: `
    <app-page-placeholder
      heading="Configurações"
      description="Preferências da aplicação e parâmetros de reconhecimento."
      epic="E7 — Persistência"
    />
  `,
})
export class SettingsPageComponent {}
