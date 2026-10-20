/** The fiat currency prices are quoted in for a display preference; a BTC preference is priced in USD. */
export function pricingCurrency(fiatCurrency: string | undefined): string {
  return !fiatCurrency || fiatCurrency === 'BTC' ? 'USD' : fiatCurrency;
}
