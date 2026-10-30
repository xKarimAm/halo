"""`.env` loading for `halo.app.main` (first PR that needs keys: llm).

The loader lives in the composition root; these tests import it from the
llm lane because this PR adds it. Values are never printed anywhere.
"""

from __future__ import annotations

from halo.app import load_dotenv


def test_load_dotenv_sets_missing_only(tmp_path, capsys):
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "# comment\n"
        "BASETEN_API_KEY=from-file\n"
        "export META_API_KEY='quoted value'\n"
        "EMPTY=\n"
        "not-a-line\n"
        "1BAD=oops\n"
        "\n",
        encoding="utf-8",
    )
    env: dict[str, str] = {"META_API_KEY": "from-env"}
    assert load_dotenv(dotenv, _environ=env) == dotenv
    assert env == {"META_API_KEY": "from-env", "BASETEN_API_KEY": "from-file", "EMPTY": ""}
    assert capsys.readouterr().out == ""


def test_load_dotenv_missing_file_returns_none(tmp_path):
    assert load_dotenv(tmp_path / ".env", _environ={}) is None
