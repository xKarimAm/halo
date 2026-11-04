# fact_check: state

Built 2026-11-04. Real API path verified through the bus; not yet seen on a live call.

## File map

| File | Holds |
|---|---|
| `fact_check.py` | `FactCheck`: takes `points.upsert` with a digit, one `search_json` call at a time on its own loop, publishes `claim.checked` for `supported` and `disputed` |
| `__init__.py` | exports `FactCheck` |
| `tests/test_fact_check.py` | number gate, Arabic digits and note language, skip/unclear silent, no-source drop, once per point, spend cap, citation marks stripped |

Wiring: `halo/app.py` builds it unless `HALO_FACT_CHECK=0`; the Gateway forwards `claim.checked`; the Overlay shows `.halo-fact`; Notes Service adds page `fact_checks`.

Cost, measured 2026-11-04: about 2,200 tokens in and 200 out when it searches, about 120 in when it skips; $0.0006 for three claims on the contributor. Meta's page gives no per-search fee, so the billing page is the truth.
