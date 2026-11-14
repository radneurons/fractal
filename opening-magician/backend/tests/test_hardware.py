"""Chessnut driver, reconciliation, robot safety and playback — against the simulated firmware,
which speaks the same documented byte protocol through the same Transport interface."""
import asyncio

import chess
import pytest

from om.hardware import codec
from om.hardware.driver import ChessnutDevice, UnsupportedOperation
from om.hardware.manager import HardwareError, HardwareManager, Playback
from om.hardware.reconcile import reconcile, setup_instructions
from om.hardware.robot import RobotSafetyError
from om.hardware.sim import SimTransport


@pytest.fixture
async def hw(db, bus):
    m = HardwareManager(db, bus)
    yield m
    await m.disconnect()


def P(fen):
    return codec.placement_of(chess.Board(fen))


# ------------------------------------------------------------------ reconciliation (pure)
def test_reconcile_simple_capture_castling_en_passant():
    b = chess.Board()
    after_e4 = chess.Board()
    after_e4.push_san("e4")
    assert reconcile(b, codec.placement_of(b)) == {"status": "in_sync"}
    assert reconcile(b, codec.placement_of(after_e4))["move"] == "e2e4"
    lifted = codec.placement_of(b)
    del lifted[chess.E2]
    r = reconcile(b, lifted)
    assert r["status"] == "in_progress" and r["hint"]["lifted"] == "e2" and set(r["hint"]["targets"]) == {"e3", "e4"}
    cap = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2")
    half = codec.placement_of(cap)
    del half[chess.D5]                                            # captured pawn removed, capturer not moved yet
    assert reconcile(cap, half)["status"] == "in_progress"
    del half[chess.E4]
    assert reconcile(cap, half)["status"] == "in_progress"
    half[chess.D5] = "P"
    assert reconcile(cap, half) == {"status": "move", "move": "e4d5", "san": "exd5"}
    cas = chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
    king_only = codec.placement_of(cas)
    del king_only[chess.E1]
    king_only[chess.G1] = "K"
    assert reconcile(cas, king_only)["status"] == "in_progress"   # rook still on h1
    del king_only[chess.H1]
    king_only[chess.F1] = "R"
    assert reconcile(cas, king_only)["move"] == "e1g1"
    ep = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")
    done = codec.placement_of(ep)
    del done[chess.E5]
    done[chess.D6] = "P"
    assert reconcile(ep, done)["status"] == "in_progress"         # the captured pawn is still on d5
    del done[chess.D5]
    assert reconcile(ep, done)["move"] == "e5d6"


def test_reconcile_promotion_takeback_and_mismatch():
    b = chess.Board("8/P7/8/8/8/8/k7/7K w - - 0 1")
    q = {chess.A8: "Q", chess.A2: "k", chess.H1: "K"}
    assert reconcile(b, q)["move"] == "a7a8q"
    n = {chess.A8: "N", chess.A2: "k", chess.H1: "K"}
    assert reconcile(b, n)["move"] == "a7a8n"                     # the piece identity decides the promotion
    pawn = {chess.A8: "P", chess.A2: "k", chess.H1: "K"}
    r = reconcile(b, pawn)
    assert r["status"] == "promotion_choice" and set(r["options"]) == {"a7a8q", "a7a8r", "a7a8b", "a7a8n"}
    assert reconcile(b, pawn, auto_queen_on_pawn=True) == {"status": "move", "move": "a7a8q", "san": "a8=Q+", "assumed_promotion": True}
    g = chess.Board()
    g.push_san("e4")
    assert reconcile(g, codec.placement_of(chess.Board()))["status"] == "takeback"
    wrong = codec.placement_of(g)
    wrong[chess.A5] = wrong.pop(chess.A2)                         # white moved a second time / illegal jump
    m = reconcile(g, wrong)
    assert m["status"] == "mismatch" and m["diff"]["missing"] == ["a2"] and m["diff"]["extra"] == ["a5"]
    steps = setup_instructions(codec.placement_of(chess.Board()), codec.placement_of(g))
    assert steps == [{"action": "move", "piece": "P", "from": "e2", "to": "e4"}]


# ------------------------------------------------------------------ driver over the simulated firmware
async def test_air_family_driver_uses_only_documented_commands(hw):
    st = await hw.connect_sim("air")
    sim = hw.sim
    assert sim.writes[0] == bytes([0x21, 0x01, 0x00]) and sim.writes[1] == bytes([0x29, 0x01, 0x00])
    assert st["device"]["simulated"] and "SIMULATED" in st["device"]["name"]
    assert st["device"]["battery"] == {"percent": 87, "charging": False} and st["device"]["board_fen"] == chess.Board().board_fen()
    assert st["robot"] is None and st["device"]["capabilities"]["report_len"] == 36
    res = await hw.guide(source=["e2"], dest=["e4"], danger=["d5"])
    assert res == {"mode": "mono", "squares": 3, "colors_shown": False}        # monochrome: no colours are claimed
    assert sim.writes[-1][:2] == bytes([0x0A, 0x08]) and len(sim.writes[-1]) == 10
    assert set(sim.state()["leds"]) == {"e2", "e4", "d5"}
    with pytest.raises(UnsupportedOperation):
        await hw.device.send_target(codec.placement_of(chess.Board()))
    with pytest.raises(UnsupportedOperation):
        await hw.device.request_piece_status()
    with pytest.raises(HardwareError, match="not robotic"):
        hw._robot()
    sim.set_battery(12, True)
    await hw.device.request_battery()
    assert hw.device.battery == {"percent": 12, "charging": True}
    assert any(r["kind"] == "led" and r["simulated"] == 1 for r in hw.log_tail(50))


async def test_physical_moves_reach_the_game_owner(hw):
    await hw.connect_sim("air")
    game = chess.Board()
    events = []
    hw.claim("test", game, events.append)
    hw.sim.play(game, game.parse_san("e4"), complete=False)                    # piece lifted, not put down
    assert events[-1]["status"] == "in_progress"
    hw.sim.place(chess.E4, "P")
    assert events[-1] == {"status": "move", "move": "e2e4", "san": "e4"}
    game.push_san("e4")
    hw.update_context("test", game)
    assert hw.last_reconcile == {"status": "in_sync"} and hw.in_sync_with(game)
    hw.sim.drop_connection()
    assert events[-1]["status"] == "disconnected" and not hw.status()["connected"]


async def test_move_robot_executes_a_verified_target(hw):
    await hw.connect_sim("move", step_time=0.02)
    assert hw.device.caps.report_len == 38 and hw.robot.state == "ready"
    target = chess.Board()
    for s in ("e4", "d5", "exd5"):
        target.push_san(s)
    st = hw.robot.plan(target, "test")
    assert st["state"] == "awaiting_confirmation" and st["operation"]["feasible"] and st["operation"]["pieces_to_move"] == 2
    assert not any(w[:2] == codec.MOVE_TARGET_HEAD for w in hw.sim.writes)     # planning sends nothing
    with pytest.raises(RobotSafetyError):
        await hw.robot.confirm(st["operation"]["id"] + 99)                     # only the previewed plan can be confirmed
    await hw.robot.confirm(st["operation"]["id"])
    assert hw.robot.state == "moving"
    with pytest.raises(RobotSafetyError, match="already in progress"):         # no overlapping / repeated requests
        hw.robot.plan(chess.Board(), "second")
    assert await hw.robot.wait(10) == "completed"
    sent = [w for w in hw.sim.writes if w[:2] == codec.MOVE_TARGET_HEAD and not codec.is_move_stop(w)]
    assert len(sent) == 1 and len(sent[0]) == 35 and sent[0][34] == codec.NON_FORCE
    assert hw.device.status()["board_fen"] == target.board_fen()
    assert "sensor reconciliation" in hw.robot.detail and "simulated" in hw.robot.detail


async def test_stop_interrupts_and_requires_recovery_without_auto_retry(hw):
    await hw.connect_sim("move", step_time=0.3)
    target = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3")
    hw.robot.plan(target, "x")
    await hw.robot.confirm(hw.robot.op["id"])
    await asyncio.sleep(0.7)
    assert any(w == codec.MOVE_PIECES_REQ for w in hw.sim.writes)              # documented piece-status telemetry is polled
    st = await hw.robot.stop()
    assert codec.is_move_stop(hw.sim.writes[-2]) or any(codec.is_move_stop(w) for w in hw.sim.writes[-4:])
    assert st["state"] == "recovery_required" and "between positions" in st["detail"]
    n_targets = len([w for w in hw.sim.writes if w[:2] == codec.MOVE_TARGET_HEAD and not codec.is_move_stop(w)])
    await asyncio.sleep(0.8)
    assert len([w for w in hw.sim.writes if w[:2] == codec.MOVE_TARGET_HEAD and not codec.is_move_stop(w)]) == n_targets   # never retried
    with pytest.raises(RobotSafetyError, match="Recovery required"):
        hw.robot.plan(target, "again")
    st = await hw.robot.recover("rescan")
    assert st["state"] == "recovery_required" and st["operation"]["manual_steps"]
    assert (await hw.robot.recover("accept"))["state"] == "ready"
    idle = await hw.robot.stop()                                               # STOP is always allowed
    assert idle["state"] == "ready"


async def test_robot_refuses_impossible_and_stale_targets_and_detects_faults(hw):
    await hw.connect_sim("move", step_time=0.02)
    st = hw.robot.plan(chess.Board("QQQ1k3/8/8/8/8/8/8/4K3 w - - 0 1"), "three queens")
    assert st["state"] == "ready" and "white queens" in st["detail"] and not st["operation"]["feasible"]
    with pytest.raises(RobotSafetyError):
        await hw.robot.execute(chess.Board("QQQ1k3/8/8/8/8/8/8/4K3 w - - 0 1"), "x")
    tgt = chess.Board()
    tgt.push_san("d4")
    op = hw.robot.plan(tgt, "y")["operation"]["id"]
    hw.sim.play(chess.Board(), chess.Move.from_uci("a2a3"))                    # a hand changes the board after planning
    assert hw.robot.state == "ready" and "discarded" in hw.robot.detail
    with pytest.raises(RobotSafetyError):
        await hw.robot.confirm(op)
    hw.sim.set_position(chess.Board())
    hw.sim.fault = "misplace"                                                  # a piece ends on the wrong square
    hw.robot.seconds_per_piece = 0.05
    hw.robot.plan(tgt, "z")
    await hw.robot.confirm(hw.robot.op["id"])
    assert await hw.robot.wait(40) == "recovery_required" and hw.robot.op["mismatch"]


async def test_manual_interference_halts_non_force_motion_and_disconnect_needs_recovery(hw):
    await hw.connect_sim("move", step_time=0.3)
    tgt = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3")
    hw.robot.plan(tgt, "x")
    await hw.robot.confirm(hw.robot.op["id"])
    await asyncio.sleep(0.2)
    hw.sim.lift(chess.A2)                                                      # user touches a piece
    assert not hw.sim.moving and "interference" in hw.sim.motion["halted"]
    hw.sim.set_position(chess.Board())
    hw.sim.step_time = 0.3
    await hw.robot.stop()
    await hw.robot.recover("accept")
    hw.robot.plan(tgt, "y")
    await hw.robot.confirm(hw.robot.op["id"])
    await asyncio.sleep(0.1)
    hw.sim.drop_connection()
    assert hw.robot.state == "disconnected" and hw.robot.needs_recovery_on_connect
    hw.robot.on_connect()
    assert hw.robot.state == "recovery_required"


async def test_live_motion_is_locked_on_real_hardware_until_verified(db, bus):
    class RealLooking(SimTransport):
        simulated = False

    m = HardwareManager(db, bus)
    t = RealLooking("move", step_time=0.02)
    from om.hardware.driver import DeviceProfile
    await m._attach(t, codec.CAPS["move"], DeviceProfile())
    tgt = chess.Board()
    tgt.push_san("e4")
    m.robot.plan(tgt, "x")
    assert not m.robot.status()["live_motion_unlocked"]
    with pytest.raises(RobotSafetyError, match="locked"):
        await m.robot.confirm(m.robot.op["id"])
    assert not any(w[:2] == codec.MOVE_TARGET_HEAD for w in t.writes)          # nothing was transmitted
    m.device.profile.robot_verified = True
    m.device.profile.stop_variant = "len36"
    await m.robot.confirm(m.robot.op["id"])
    assert await m.robot.wait(10) == "completed"
    await m.robot.stop()
    assert len(t.writes[-2]) == 36 or any(len(w) == 36 and codec.is_move_stop(w) for w in t.writes)
    await m.disconnect()


async def test_robot_playback_is_sequential_and_guided_playback_waits_for_the_learner(hw):
    await hw.connect_sim("move", step_time=0.02)
    pb = Playback(hw, chess.STARTING_FEN, ["e4", "e5", "Nf3", "Nc6", "Bb5"], mode="robot", speed_ms=20, title="Ruy Lopez")
    assert pb.support["robot"] and pb.sans == ["e4", "e5", "Nf3", "Nc6", "Bb5"]
    hw.playback = pb
    await pb.play()
    for _ in range(400):
        if pb.state in ("done", "error"):
            break
        await asyncio.sleep(0.05)
    assert pb.state == "done" and pb.index == 5 and pb.sync == "verified"
    targets = [w for w in hw.sim.writes if w[:2] == codec.MOVE_TARGET_HEAD and not codec.is_move_stop(w)]
    assert len(targets) == 5                                                   # one verified target per move, never queued
    final = chess.Board()
    for s in pb.sans:
        final.push_san(s)
    assert hw.device.status()["board_fen"] == final.board_fen()
    await pb.goto(2)
    assert hw.device.status()["board_fen"].startswith("rnbqkbnr/pppp1ppp/8/4p3/4P3")
    promo = Playback(hw, "8/PPP4k/8/8/8/8/8/K7 w - - 0 1", ["a8=Q", "Kg7", "b8=Q", "Kf7", "c8=Q"], mode="robot")
    assert not promo.support["robot"] and "piece set" in promo.support["reasons"][0]
    with pytest.raises(HardwareError):
        await promo.play()
    await hw.connect_sim("air")
    g = Playback(hw, chess.STARTING_FEN, ["d4", "d5"], mode="guided", speed_ms=10)
    assert g.support["guided"] and not g.support["robot"]
    hw.playback = g
    await g.play()
    for _ in range(100):
        if g.state == "waiting_board":
            break
        await asyncio.sleep(0.02)
    assert g.state == "waiting_board" and "d4" in g.detail and set(hw.sim.state()["leds"]) == {"d2", "d4"}
    hw.sim.play(chess.Board(), chess.Move.from_uci("d2d4"))
    for _ in range(100):
        if g.index == 1 and g.state == "waiting_board":
            break
        await asyncio.sleep(0.02)
    assert g.index == 1 and "d5" in g.detail
    await g.stop()
    assert g.state == "stopped" and hw.sim.state()["leds"] == {}


async def test_unknown_models_are_not_driven(hw):
    with pytest.raises(HardwareError, match="Unrecognised"):
        await hw.connect("AA:BB", "Chessnut Evo")
    assert len(codec.DOC_AMBIGUITIES) == 4 and hw.status()["ambiguities"]
