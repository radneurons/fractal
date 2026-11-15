"""Optional online game import (Lichess / Chess.com public APIs).

This is the only part of Opening Magician that touches the internet, and only when the user asks
for it.  Everything it returns is plain PGN that then goes through the normal offline import."""
from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.parse
import urllib.request

AGENT = "OpeningMagician/1.0 (local chess study tool)"


class OnlineError(ValueError):
    pass


def _get(url: str, accept: str = "*/*", timeout: float = 40.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise OnlineError("That player was not found")
        if e.code == 429:
            raise OnlineError("The site is rate-limiting requests — wait a minute and try again")
        raise OnlineError(f"The site answered with an error ({e.code})")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise OnlineError(f"Could not reach the site: {getattr(e, 'reason', e)}. You can still import a PGN file instead.")


def _clean(username: str) -> str:
    u = username.strip()
    if not u or not all(ch.isalnum() or ch in "-_" for ch in u) or len(u) > 40:
        raise OnlineError("Enter a plain username (letters, digits, - and _)")
    return u


def fetch_lichess(username: str, max_games: int = 300) -> str:
    u = _clean(username)
    q = urllib.parse.urlencode({"max": max(1, min(int(max_games), 2000)), "perfType": "blitz,rapid,classical,correspondence", "rated": "true"})
    return _get(f"https://lichess.org/api/games/user/{u}?{q}", "application/x-chess-pgn", 120).decode("utf-8", "replace")


def fetch_chesscom(username: str, max_games: int = 300) -> str:
    u = _clean(username).lower()
    archives = json.loads(_get(f"https://api.chess.com/pub/player/{u}/games/archives", "application/json"))
    out, count = [], 0
    for url in reversed(archives.get("archives", [])):
        if not url.startswith("https://api.chess.com/pub/player/"):
            continue
        pgn = _get(url + "/pgn", "application/x-chess-pgn", 90).decode("utf-8", "replace")
        out.append(pgn)
        count += pgn.count("[Event ")
        if count >= max_games:
            break
    return "\n\n".join(out)


async def fetch(site: str, username: str, max_games: int = 300) -> str:
    fn = {"lichess": fetch_lichess, "chesscom": fetch_chesscom}.get(site)
    if fn is None:
        raise OnlineError("site must be 'lichess' or 'chesscom'")
    pgn = await asyncio.to_thread(fn, username, max_games)
    if "[Event" not in pgn:
        raise OnlineError("No games were returned for that player")
    return pgn
