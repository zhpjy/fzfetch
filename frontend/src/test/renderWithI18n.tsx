import React from 'react';
import { render } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nProvider';
import { Locale } from '../i18n/types';

interface RenderWithI18nOptions {
  initialLocale?: Locale;
}

export function renderWithI18n(ui: React.ReactElement, options?: RenderWithI18nOptions) {
  return render(
    <I18nProvider initialLocale={options?.initialLocale}>
      {ui}
    </I18nProvider>,
  );
}
