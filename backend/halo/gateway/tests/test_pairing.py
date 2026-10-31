"""Pairing store tests (PLAN case 4b): single-use codes, hashed tokens,
restart persistence. No sockets here; the HTTP + socket layers are tested
separately against this store."""

from __future__ import annotations

from halo.gateway.pairing import PairingStore


def test_redeem_issues_token_once(tmp_path):
    store = PairingStore(tmp_path)
    token = store.redeem(store.current_code)
    assert isinstance(token, str) and token
    assert store.check(token) is True
    assert store.redeem(store.current_code) is None  # spent
    assert store.check("nope") is False


def test_wrong_and_malformed_codes_rejected(tmp_path):
    store = PairingStore(tmp_path)
    wrong = "000001" if store.current_code != "000001" else "000002"
    assert store.redeem(wrong) is None
    assert store.redeem("short") is None
    assert store.redeem(123456) is None
    assert store.redeem("") is None
    # The real code still works exactly once.
    assert isinstance(store.redeem(store.current_code), str)
    assert store.redeem(store.current_code) is None


def test_restart_keeps_tokens_and_kills_old_code(tmp_path):
    first = PairingStore(tmp_path)
    token = first.redeem(first.current_code)
    assert token is not None
    old_code = first.current_code

    second = PairingStore(tmp_path)  # a backend restart: new code printed
    assert second.check(token) is True  # no re-pairing needed
    assert second.redeem(old_code) is None  # the spent code stays spent
    assert second.redeem(second.current_code) is not None


def test_store_file_holds_hashes_never_tokens(tmp_path):
    store = PairingStore(tmp_path)
    token = store.redeem(store.current_code)
    assert token is not None
    raw = store.store_file.read_text(encoding="utf-8")
    assert token not in raw
    assert store.store_file.name == "pairing.json"
