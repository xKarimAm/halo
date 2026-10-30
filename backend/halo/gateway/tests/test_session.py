"""Socket session tests: the contracts ACK kit runs inside this suite.

Loads `contracts/ack-kit/*.json` directly (the kit names gateway as a
runner): valid -> ok + one publish; duplicate/resend -> ok + still one
publish; unpaired/invalid-schema/unknown-type -> typed errors, nothing
published. Replies are checked with `validate_ack` / `validate_envelope`.
"""

from __future__ import annotations

import json
from pathlib import Path

from contracts.validate import validate_ack, validate_envelope

from halo.bus import Bus
from halo.gateway.gateway import Gateway
from halo.gateway.session import SocketSession

KIT = Path(__file__).parents[4] / "contracts" / "ack-kit"
MEETING = "22222222-2222-4222-8222-222222222222"


def kit(name: str) -> dict:
    return json.loads((KIT / name).read_text(encoding="utf-8"))


def hello_envelope(token: str) -> dict:
    return {
        "specversion": "1.0",
        "id": "00000001-0000-4000-8000-000000000001",
        "type": "pair.hello",
        "source": "halo/test",
        "time": "2026-10-31T09:00:00Z",
        "meetingid": None,
        "datacontenttype": "application/json",
        "data": {"token": token, "ext_version": "0.1.0"},
    }


def attach(gateway: Gateway) -> tuple[SocketSession, list]:
    session = SocketSession(gateway)
    out: list = []

    async def sender(envelope: dict) -> None:
        out.append(envelope)

    gateway.attach(session, sender)
    return session, out


async def paired(gateway: Gateway) -> tuple[SocketSession, list]:
    # The pairing code is single-use per backend: redeem once, reuse the token.
    token = getattr(gateway, "_test_token", None)
    if token is None:
        token = gateway.pairing.redeem(gateway.pairing.current_code)
        gateway._test_token = token
    assert token is not None
    session, out = attach(gateway)
    reply = await session.handle_text(json.dumps(hello_envelope(token)))
    assert reply["type"] == "pair.ok"
    assert validate_envelope(reply) == []
    assert session.session_id is not None
    return session, out


def test_ack_kit_duplicate_and_resend_publish_once(tmp_path):
    import asyncio

    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        published: list = []
        gateway.bus.subscribe("points.upsert", published.append)
        session, _ = await paired(gateway)

        first = json.dumps(kit("duplicate.json")["envelope"])
        ack1 = await session.handle_text(first)
        ack2 = await session.handle_text(first)  # the resend after a dropped ACK
        assert [ack1, ack2] == [
            {"ack_of": "00000013-0000-4000-8000-000000000013", "status": "ok"},
            {"ack_of": "00000013-0000-4000-8000-000000000013", "status": "ok"},
        ]
        assert validate_ack(ack1) == [] and validate_ack(ack2) == []
        assert len(published) == 1

    asyncio.run(run())


def test_ack_kit_errors_publish_nothing(tmp_path):
    import asyncio

    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        published: list = []
        gateway.bus.subscribe("points.upsert", published.append)
        fresh, _ = attach(gateway)

        unpaired = await fresh.handle_text(json.dumps(kit("unpaired.json")["envelope"]))
        assert unpaired["status"] == "error" and unpaired["error"]["code"] == "unpaired"
        assert validate_ack(unpaired) == []

        session, _ = await paired(gateway)
        bad = await session.handle_text(json.dumps(kit("invalid-schema.json")["envelope"]))
        assert bad["error"]["code"] == "invalid_schema"
        unknown = await session.handle_text(json.dumps(kit("unknown-type.json")["envelope"]))
        assert unknown["error"]["code"] == "unknown_type"
        assert validate_ack(bad) == [] and validate_ack(unknown) == []
        assert published == []

    asyncio.run(run())


def test_pair_hello_bad_token_and_malformed_rejected(tmp_path):
    import asyncio

    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        session, _ = attach(gateway)
        rejected = await session.handle_text(json.dumps(hello_envelope("wrong-token")))
        assert rejected["type"] == "pair.rejected"
        assert validate_envelope(rejected) == []
        assert session.paired is False

        broken = hello_envelope("x")
        del broken["data"]["ext_version"]
        rejected2 = await session.handle_text(json.dumps(broken))
        assert rejected2["type"] == "pair.rejected"

        garbage = await session.handle_text("{oops")
        assert garbage["error"]["code"] == "invalid_schema"
        lst = await session.handle_text("[1, 2]")
        assert lst["error"]["code"] == "invalid_schema"

    asyncio.run(run())


def test_resend_across_reconnect_dedupes(tmp_path):
    import asyncio

    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        published: list = []
        gateway.bus.subscribe("points.upsert", published.append)
        first, _ = await paired(gateway)
        raw = json.dumps(kit("duplicate.json")["envelope"])
        assert (await first.handle_text(raw))["status"] == "ok"
        gateway.detach(first)

        second, _ = await paired(gateway)  # reconnected socket, new session
        assert (await second.handle_text(raw))["status"] == "ok"
        assert len(published) == 1

    asyncio.run(run())


def test_hello_never_reaches_the_bus(tmp_path):
    import asyncio

    async def run():
        gateway = Gateway(Bus(), data_dir=tmp_path, extension_id="test-id")
        seen: list = []
        gateway.bus.subscribe("pair.hello", seen.append)
        session, _ = attach(gateway)
        token = gateway.pairing.redeem(gateway.pairing.current_code)
        await session.handle_text(json.dumps(hello_envelope(token)))
        assert seen == [] and session.paired is True

    asyncio.run(run())
