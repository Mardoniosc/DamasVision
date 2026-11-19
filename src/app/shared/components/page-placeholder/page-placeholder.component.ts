import { Component, input } from '@angular/core';

/**
 * Reusable placeholder for routes whose feature is scheduled for a later epic.
 * Presentational only: receives text through inputs and renders it.
 */
@Component({
  selector: 'app-page-placeholder',
  template: `
    <section class="space-y-4" [attr.aria-labelledby]="headingId">
      <h1 [id]="headingId" class="text-2xl font-semibold tracking-tight">{{ heading() }}</h1>
      <p class="max-w-prose text-stone-600">{{ description() }}</p>
      <p
        class="inline-block rounded-md border border-dashed border-stone-300 bg-white px-3 py-2 text-sm text-stone-600"
        role="status"
      >
        Em construção — previsto para o épico <strong class="font-semibold">{{ epic() }}</strong>.
      </p>
      <ng-content />
    </section>
  `,
})
export class PagePlaceholderComponent {
  readonly heading = input.required<string>();
  readonly description = input.required<string>();
  readonly epic = input.required<string>();

  protected readonly headingId = 'page-heading';
}
