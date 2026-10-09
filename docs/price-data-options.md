# Paid price data options

Researched on 9 October 2026. No change has been made: Tickerdeck still runs on the free Tiingo plan.

All times are New York time. Prices are in US dollars unless stated.

## Summary

Tiingo Power at $30/month is the cheapest sensible step. A true full-market off-hours price starts at $99/month with Alpaca.

- **Goal:** US stock prices that update about every second, plus pre-market and after-hours prices.
- **Today:** stock prices refresh only when a chart is opened. Crypto already updates every 10 seconds at no cost.
- **Pick Tiingo Power ($30)** if second-level prices in regular hours are the main goal and a rough off-hours price is enough.
- **Pick Alpaca ($99)** if the off-hours price must match what TradingView shows. Confirm with their support that your country is accepted before paying.
- **Try the free options first:** they may cover part of the goal at no cost.

## Paid options compared

Sorted by price. "Full market" means prices from all US exchanges. "One exchange" means few trades off-hours, so the price can lag the real one.

| Option | Price / month | Second-level updates | Off-hours prices | Main catch |
| --- | --- | --- | --- | --- |
| [Tiingo Power](https://www.tiingo.com/about/pricing) | $30 ($300/year) | Yes | 8:00–9:30 and 16:00–17:00, one exchange | Smallest change: Tickerdeck already uses Tiingo |
| [EODHD Active Trader](https://eodhd.com/pricing) | €29.99 | Yes, up to 50 tickers | 4:00–20:00, one exchange | New provider to wire in |
| [Alpha Vantage Premium](https://www.alphavantage.co/premium/) | from $49.99 | About one refresh per second, no streaming | 4:00–20:00, full market | Not confirmed that the cheapest tier includes real-time |
| [Twelve Data Pro](https://twelvedata.com/pricing) | $99 | Yes, up to 500 tickers | 7:00–20:00, about 5% of market volume | Cheaper tiers cannot stream |
| [Alpaca Algo Trader Plus](https://alpaca.markets/data) | $99 | Yes, unlimited tickers | Full market, same stream | Needs an approved brokerage account; country not confirmed |
| [Massive (ex-Polygon) Advanced](https://massive.com/pricing) | $199 | Yes | 4:00–20:00, full market | Its $29 and $79 tiers are 15 minutes delayed |
| [Databento Standard](https://databento.com/pricing) | $199 | Yes | Not confirmed | Blended feed from several venues, not the full market |

Prices for Tiingo, Alpaca, Massive and Twelve Data were re-checked on their own pricing pages on 9 October 2026. The others come from one research pass.

## Free options to test first

- **Tiingo's new multi-venue feed (beta since 7 July 2026).** Covers 4:00–20:00 across several venues. It may work with the current free key. Tiingo still recommends its older feed for dependable use, and which plans include it is not confirmed.
- **Finnhub free tier.** Streams live prices for up to 50 tickers. Its off-hours coverage and data source are not documented, so it needs a test before the US market opens.
- **Alpaca free tier.** Streams live prices for up to 30 tickers from one exchange, with off-hours 8:00–9:30 and 16:00–17:00. Same data quality as Tiingo's current feed.

## Tiingo terms on storing data

Since 6 October 2026, Tiingo's free plan no longer allows saving its data to disk. Tickerdeck saves the stock price history to its database, so this needs a decision.

- **The rule** ([Tiingo terms](https://app.tiingo.com/tos/), section 1.6): on free and trial plans, data may only be held in memory and must be removed right after use.
- **Paid plans** may store data. On cancelling or downgrading, all stored Tiingo data must be deleted, backups included.
- **Ways to comply:**
  - Move to Tiingo Power ($30/month), which allows storage.
  - Change Tickerdeck to re-download stock history instead of saving it. The free request limits (50 per hour, 1,000 per day) make this slow for a large watchlist.
  - Move stock history to another provider whose free terms allow storage. Not researched yet.
- **Decision on 9 October 2026:** no change for now.

## Notes per provider

### Tiingo

- Free plan: 50 requests per hour, 1,000 per day, 500 different tickers per month.
- Power for individuals: $30/month or $300/year; 10,000 requests per hour, 100,000 per day. The $50 plan is for businesses.
- Prices come from one exchange (IEX), in regular hours and off-hours alike. Volume shown during the day is that exchange's only.
- Overnight add-on: +$9/month, covers 20:00–4:00 only, not pre-market or after-hours.
- Personal use only: no showing or sharing the data with other people.

### Alpaca

- Free: live prices from one exchange, 30 tickers, 200 requests per minute.
- Algo Trader Plus, $99/month: live prices from all US exchanges, unlimited tickers.
- The full-market feed requires an approved live brokerage account. No minimum deposit; non-US users can fund from $1.
- Available in 195+ countries per their guide, without a published list.
- Price history goes back to 2016 only, so long history would stay with another provider.

### Massive (formerly Polygon)

- Starter $29 and Developer $79 are 15 minutes delayed, including off-hours.
- Advanced $199 is the first real-time tier, with 20+ years of history.
- Individual, non-professional use only. No country restriction for Europe.

### Twelve Data

- Grow tiers ($29–$79) give real-time prices on request but cannot stream.
- Pro $99: streaming for 500 tickers, off-hours 7:00–20:00.
- Prices come from about 5% of US trading volume. VAT is added for individuals.

### EODHD

- €29.99/month (€24.99 billed yearly): streaming for 50 tickers, 4:00–20:00.
- Prices come from one exchange (Cboe EDGX).

### Alpha Vantage

- $49.99 to $249.99/month. No streaming; one bulk request per second covers up to 100 tickers.
- Real-time needs a separate entitlement requested after payment.

### Finnhub

- Free: live stream for 50 tickers. Paid: $49.99 (250 tickers), $129.99 and $199.99 (unlimited).
- Personal use only; data must be deleted on cancellation.

### Financial Modeling Prep

- $19 / $49 / $99 per month on yearly billing. Real-time and streaming appear to be enterprise features, so it is not a fit as far as could be confirmed.

### Databento

- From $199/month, subscription only since January 2025. Blended price from several venues, not the full market.

## To check before paying

These points could not be confirmed on the providers' own pages.

- [ ] Alpaca: is your country accepted, and is a funded account required to subscribe to the $99 plan?
- [ ] Alpaca: exact off-hours window of the full-market feed (expected 4:00–20:00).
- [ ] Tiingo: which plans include the new multi-venue feed, and any limits on its streaming.
- [ ] Alpha Vantage: does the $49.99 tier qualify for real-time US data?
- [ ] Finnhub: off-hours coverage and data source on the free tier.
- [ ] EODHD and Alpha Vantage: re-check prices, read once only.
- [ ] Databento: price for US stocks (the page did not load fully) and off-hours coverage.
- [ ] All providers: prices and terms change; Tiingo changed its terms three days before this research.

## Sources

Pages read on 9 October 2026.

- Tiingo: [pricing](https://www.tiingo.com/about/pricing), [terms](https://app.tiingo.com/tos/), [IEX feed docs](https://www.tiingo.com/documentation/iex), [IEX streaming docs](https://www.tiingo.com/documentation/websockets/iex), [multi-venue feed docs](https://www.tiingo.com/documentation/equity-realtime-stock-data), [overnight feed docs](https://www.tiingo.com/documentation/boats)
- IEX exchange: [trading hours](https://www.iex.io/resources/trading/trading-hours-holidays), [fee schedule](https://www.iex.io/resources/trading/fee-schedule)
- Alpaca: [data plans](https://alpaca.markets/data), [market data overview](https://docs.alpaca.markets/us/docs/about-market-data-api), [market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq), [non-US accounts](https://alpaca.markets/learn/live-trading-account-non-us)
- Massive: [pricing](https://massive.com/pricing), [individual terms](https://massive.com/legal/individuals-terms-of-service), [stocks streaming docs](https://massive.com/docs/websocket/stocks/overview.md)
- Twelve Data: [pricing](https://twelvedata.com/pricing), [pre/post market data](https://support.twelvedata.com/en/articles/5195429-pre-post-market-data), [US equities data](http://support.twelvedata.com/en/articles/9935903-us-equities-market-data)
- EODHD: [pricing](https://eodhd.com/pricing), [streaming API](https://eodhd.com/financial-apis/new-real-time-data-api-websockets)
- Alpha Vantage: [premium plans](https://www.alphavantage.co/premium/), [real-time data policy](https://www.alphavantage.co/realtime_data_policy/)
- Finnhub: [pricing](https://finnhub.io/pricing), [terms](https://finnhub.io/terms-of-service)
- Financial Modeling Prep: [pricing](https://site.financialmodelingprep.com/pricing-plans), [enterprise](https://site.financialmodelingprep.com/enterprise)
- Databento: [pricing](https://databento.com/pricing), [US equities](https://databento.com/equities)
