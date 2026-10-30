# /contracts

Wave 0. The only thing modules share: the CloudEvents envelope, ACK rules, the two-plane rule, the event catalog (AsyncAPI + JSON Schema), the clock and coordinate rules, the `MeetingAdapter` interface, one golden sample per type, and the generated TS + pydantic types.

Source: `docs/DECISIONS.md` section 4 and the grey boxes in `docs/architecture/halo-v2-final.drawio`. A change here needs the `contract-change` label and Karim's merge.
