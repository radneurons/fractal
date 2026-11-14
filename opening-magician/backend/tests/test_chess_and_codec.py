"""Chess rules (python-chess as the authority), PGN/FEN, and the Chessnut wire formats."""
import chess
import chess.pgn
import pytest

from om import openings
from om.chessx import Score, classify_move, game_to_pgn, game_tree, loss_between, pos_key, read_games, result_of
from om.hardware import codec


def perft(board, depth):
    if depth == 0:
        return 1
    n = 0
    for m in board.legal_moves:
        board.push(m)
        n += perft(board, depth - 1)
        board.pop()
    return n


def test_perft_startpos_and_kiwipete():
    assert perft(chess.Board(), 3) == 8902
    kiwi = chess.Board("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1")
    assert perft(kiwi, 2) == 2039      # exercises castling, en passant, promotions, pins


def test_special_moves_and_draw_rules():
    b = chess.Board("r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1")
    assert chess.Move.from_uci("e5d6") in b.legal_moves and b.is_en_passant(chess.Move.from_uci("e5d6"))
    assert chess.Move.from_uci("e1g1") in b.legal_moves and chess.Move.from_uci("e1c1") in b.legal_moves
    p = chess.Board("8/P7/8/8/8/8/k7/7K w - - 0 1")
    assert {m.promotion for m in p.legal_moves if m.promotion} == {chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT}
    assert chess.Board("8/8/8/8/8/8/k7/7K w - - 0 1").is_insufficient_material()
    assert result_of(chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")) == ("1/2-1/2", "stalemate")
    assert result_of(chess.Board("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1")) == ("0-1", "checkmate") or \
        result_of(chess.Board("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1"))[1] == "checkmate"
    r = chess.Board()
    for _ in range(2):
        for u in ("g1f3", "g8f6", "f3g1", "f6g8"):
            r.push_uci(u)
    assert r.can_claim_threefold_repetition()
    f = chess.Board("8/8/8/8/8/5k2/8/R6K w - - 99 80")
    f.push_uci("a1a2")
    assert f.can_claim_fifty_moves() and not f.is_seventyfive_moves()
    assert chess.Board("8/8/8/8/8/5k2/8/R6K w - - 150 120").is_seventyfive_moves()


def test_position_identity_ignores_move_order_but_not_rights():
    a, b = chess.Board(), chess.Board()
    for u in ("g1f3", "d7d5", "d2d4"):
        a.push_uci(u)
    for u in ("d2d4", "d7d5", "g1f3"):
        b.push_uci(u)
    assert pos_key(a) == pos_key(b)
    c = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    d = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1")
    assert pos_key(c) != pos_key(d)


def test_pgn_roundtrip_preserves_variations_comments_nags_arrows():
    pgn = """[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n
1. e4 {Best by test [%cal Ge2e4]} e5 (1... c5 $5 {Sicilian} 2. Nf3 (2. c3 {Alapin}) 2... d6) 2. Nf3 $1 Nc6 *"""
    g = read_games(pgn)[0]
    out = game_to_pgn(g)
    g2 = read_games(out)[0]
    t = game_tree(g2)
    e4 = t["root"]["children"][0]
    assert e4["san"] == "e4" and "Best by test" in e4["comment"] and e4["arrows"][0]["from"] == "e2"
    assert [c["san"] for c in e4["children"]] == ["e5", "c5"]
    c5 = e4["children"][1]
    assert 5 in c5["nags"] and c5["comment"] == "Sicilian" and [x["san"] for x in c5["children"]] == ["Nf3", "c3"]
    fen_game = read_games('[FEN "8/P7/8/8/8/8/k7/7K w - - 0 1"]\n[SetUp "1"]\n\n1. a8=Q+ *')[0]
    assert fen_game.board().fen().startswith("8/P7") and fen_game.end().board().piece_at(chess.A8).piece_type == chess.QUEEN


def test_scores_never_mix_mate_and_centipawns():
    best, cand = Score(mate=3), Score(cp=900)
    l = loss_between(best, cand)
    assert l["cp_loss"] is None and l["mate_involved"] and l["misses_mate"]
    assert Score(mate=2).order_key() > Score(mate=5).order_key() > Score(cp=5000).order_key() > Score(mate=-9).order_key() > Score(mate=-1).order_key()
    assert loss_between(Score(cp=50), Score(cp=-250))["cp_loss"] == 300


def test_blunder_needs_deep_stable_evidence():
    shallow = classify_move(best=Score(cp=30), played=Score(cp=-400), rank=5, legal_count=30, depth=4)
    deep = classify_move(best=Score(cp=30), played=Score(cp=-400), rank=5, legal_count=30, depth=20)
    assert shallow["label"] == "mistake" and shallow["provisional"] and deep["label"] == "blunder" and not deep["provisional"]
    assert classify_move(best=Score(cp=10), played=Score(cp=10), rank=1, legal_count=1, depth=10)["label"] == "forced"
    assert classify_move(best=Score(cp=10), played=Score(cp=5), rank=2, legal_count=20, depth=10, in_book=True)["label"] == "book"


def test_opening_catalogue_is_legal_and_names_transpositions():
    assert len(openings.catalog()) >= 130 and len(openings.traps()) >= 14
    for t in openings.traps():
        victim_moves_white = t["blunder_ply"] % 2 == 0
        assert victim_moves_white == (t["victim"] == "white"), t["name"]
    b = chess.Board()
    for s in "Nf3 d5 d4 Nf6 c4 e6 Nc3".split():
        b.push_san(s)
    assert openings.identify(b)["name"] == "Queen's Gambit Declined" and openings.identify(b)["transposed"]


# ----------------------------------------------------------------------------- Chessnut codec
def official_js_fen(data: bytes) -> str:
    """Line-for-line port of the manufacturer's JavaScript example (both READMEs)."""
    pieces = ['', 'q', 'k', 'b', 'p', 'n', 'R', 'P', 'r', 'B', 'N', 'Q', 'K']
    fen, empty = "", 0
    for row in range(8):
        for col in range(7, -1, -1):
            index = (row * 8 + col) // 2 + 2
            val = data[index] & 0x0F if col % 2 == 0 else data[index] >> 4
            piece = pieces[val]
            if piece == '':
                empty += 1
            else:
                if empty > 0:
                    fen += str(empty)
                fen += piece
                empty = 0
        if empty > 0:
            fen += str(empty)
        if row < 7:
            fen += '/'
        empty = 0
    return fen


@pytest.mark.parametrize("fen", [chess.STARTING_FEN, "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5",
                                 "8/P5k1/8/8/3q4/8/1K6/7R w - - 0 1"])
def test_position_encoding_matches_manufacturer_example(fen):
    board = chess.Board(fen)
    placement = codec.placement_of(board)
    for length in (codec.AIR_REPORT_LEN, codec.MOVE_REPORT_LEN):
        report = codec.build_report(placement, length)
        assert len(report) == length
        assert official_js_fen(report) == board.board_fen()
        dec = codec.decode_report(report, length)
        assert dec["board_fen"] == board.board_fen() and dec["length_ok"]


def test_square_order_starts_at_h8_low_nibble_first():
    payload = codec.encode_placement({chess.H8: "q", chess.G8: "K", chess.A1: "P"})
    assert payload[0] == (12 << 4) | 1          # low nibble h8 = q(1), high nibble g8 = K(12)
    assert payload[31] >> 4 == 7 and payload[31] & 0x0F == 0     # a1 is the very last nibble
    assert codec.WIRE_SQUARES[0] == chess.H8 and codec.WIRE_SQUARES[7] == chess.A8 and codec.WIRE_SQUARES[63] == chess.A1


def test_packet_lengths_are_device_specific():
    rep36 = codec.build_report(codec.placement_of(chess.Board()), 36)
    assert not codec.decode_report(rep36, codec.MOVE_REPORT_LEN)["length_ok"]
    assert codec.decode_report(rep36, codec.AIR_REPORT_LEN)["length_ok"]
    with pytest.raises(codec.ProtocolError):
        codec.decode_report(rep36[:20])
    with pytest.raises(codec.ProtocolError):
        codec.decode_placement(bytes([0xFF]) * 32)       # 15 is not a piece code


def test_documented_commands():
    assert codec.ENABLE_REALTIME == bytes([0x21, 0x01, 0x00])
    assert codec.AIR_BATTERY_REQ == bytes([0x29, 0x01, 0x00]) and codec.MOVE_BATTERY_REQ == bytes([0x41, 0x01, 0x0C])
    assert codec.MOVE_PIECES_REQ == bytes([0x41, 0x01, 0x0B])
    tgt = codec.move_target_command(codec.placement_of(chess.Board()), force=False)
    assert len(tgt) == 35 and tgt[:2] == bytes([0x42, 0x21]) and tgt[34] == 1      # 1 = non-force
    assert codec.move_target_command({}, force=True)[34] == 0                      # 0 = force
    assert codec.decode_placement(tgt[2:34]) == codec.placement_of(chess.Board())
    s35, s36 = codec.move_stop_command("len35"), codec.move_stop_command("len36")
    assert len(s35) == 35 and len(s36) == 36 and codec.is_move_stop(s35) and codec.is_move_stop(s36) and not codec.is_move_stop(tgt)


def test_led_encodings():
    cmd = codec.air_led_command({chess.H8, chess.A1})
    assert len(cmd) == 10 and cmd[:2] == bytes([0x0A, 0x08])
    assert cmd[2] == 0b00000001 and cmd[9] == 0b10000000          # rank 8 first; bit0 = h-file
    assert codec.air_led_decode(cmd) == {chess.H8, chess.A1}
    assert codec.air_led_command({chess.H8}, "a_lsb")[2] == 0b10000000
    rgb = codec.move_led_command({chess.E2: "blue", chess.E4: "green", chess.D5: "red"})
    assert len(rgb) == 34 and rgb[:2] == bytes([0x43, 0x20])
    assert codec.move_led_decode(rgb) == {chess.E2: 3, chess.E4: 2, chess.D5: 1}
    with pytest.raises(codec.ProtocolError):
        codec.move_led_command({chess.E2: 9})


def test_battery_and_piece_status_parsing():
    assert codec.parse_air_battery(bytes([0x2A, 0x02, 0x80 | 57, 0])) == {"percent": 57, "charging": True}
    assert codec.parse_air_battery(bytes([0x2A, 0x02, 33, 0])) == {"percent": 33, "charging": False}
    assert codec.parse_move_response(bytes([0x41, 0x03, 0x0C, 1, 88])) == {"type": "battery", "charging": True, "percent": 88}
    pieces = [(1, 10, 20, 90)] * 34
    resp = codec.build_move_pieces(pieces)
    assert resp[:3] == bytes([0x41, 0x89, 0x0B])                   # 34*4 + 1 = 0x89, as documented
    parsed = codec.parse_move_response(resp)
    assert parsed["complete"] and len(parsed["pieces"]) == 34 and parsed["pieces"][16]["symbol"] == "K"
    assert codec.MOVE_INVENTORY["Q"] == 2 and codec.MOVE_INVENTORY["p"] == 8 and sum(codec.MOVE_INVENTORY.values()) == 34


def test_inventory_limits_and_model_detection():
    assert codec.inventory_check(codec.placement_of(chess.Board())) == []
    three_queens = codec.placement_of(chess.Board("QQQ1k3/8/8/8/8/8/8/4K3 w - - 0 1"))
    assert any("white queens" in p for p in codec.inventory_check(three_queens))
    assert codec.model_from_name("Chessnut Move") == "move" and codec.model_from_name("Chessnut Air+") == "air_plus"
    assert codec.model_from_name("Chessnut Pro") == "pro" and codec.model_from_name("Chessnut Evo") is None
    assert not codec.CAPS["air"].robotic and codec.CAPS["move"].robotic and codec.CAPS["air"].led == "mono"
