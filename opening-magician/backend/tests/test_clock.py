from om.clock import BLACK, WHITE, Clock, PRESETS, normalize_config

T0 = 1_000_000.0


def mk(cfg, **kw):
    c = Clock.create(cfg, **kw)
    c.start(WHITE, T0)
    return c


def test_fischer_increment_and_handover():
    c = mk({"kind": "standard", "stages": [{"base_ms": 60_000, "increment_ms": 2_000}]})
    info = c.press(T0 + 5)
    assert info["charged_ms"] == 5000 and c.remaining[WHITE] == 57_000 and c.running == BLACK
    assert c.time_left(BLACK, T0 + 8) == 57_000
    c.press(T0 + 8)
    assert c.remaining[BLACK] == 59_000


def test_simple_delay_only_charges_after_delay():
    c = mk({"kind": "standard", "stages": [{"base_ms": 60_000, "delay_ms": 5_000, "delay_type": "simple"}]})
    assert c.time_left(WHITE, T0 + 3) == 60_000 and c.delay_left(T0 + 3) == 2000
    c.press(T0 + 3)
    assert c.remaining[WHITE] == 60_000
    c.press(T0 + 3 + 9)
    assert c.remaining[BLACK] == 56_000


def test_bronstein_gives_back_at_most_the_time_used():
    c = mk({"kind": "standard", "stages": [{"base_ms": 60_000, "delay_ms": 5_000, "delay_type": "bronstein"}]})
    c.press(T0 + 2)
    assert c.remaining[WHITE] == 60_000          # used 2 s, got 2 s back
    c.press(T0 + 2 + 12)
    assert c.remaining[BLACK] == 60_000 - 12_000 + 5_000


def test_multi_stage_adds_time_at_the_control():
    c = mk({"kind": "standard", "stages": [{"moves": 2, "base_ms": 10_000}, {"base_ms": 30_000, "increment_ms": 1000}]})
    t = T0
    for _ in range(2):
        t += 1
        c.press(t)   # white
        t += 1
        c.press(t)   # black
    assert c.stage[WHITE] == 1 and c.remaining[WHITE] == 10_000 - 2_000 + 30_000
    snap = c.snapshot(t)
    assert snap["white"]["stage"] == 1 and snap["white"]["increment_ms"] == 1000


def test_hourglass_and_per_move():
    h = mk({"kind": "hourglass", "stages": [{"base_ms": 60_000}]})
    h.press(T0 + 10)
    assert h.remaining[WHITE] == 50_000 and h.remaining[BLACK] == 70_000
    p = mk({"kind": "per_move", "per_move_ms": 10_000})
    assert not p.press(T0 + 9)["flagged"] and p.remaining[WHITE] == 10_000
    assert p.press(T0 + 9 + 11)["flagged"]


def test_flag_policies():
    lose = mk({"kind": "standard", "stages": [{"base_ms": 1_000}]})
    assert lose.check_flag(T0 + 0.5) is None and lose.check_flag(T0 + 1.5) == WHITE and lose.lost_on_time() == WHITE
    assert lose.check_flag(T0 + 2) is None            # reported once
    train = mk({"kind": "standard", "flag_policy": "continue", "stages": [{"base_ms": 1_000, "increment_ms": 5000}]})
    assert train.check_flag(T0 + 2) == WHITE and train.lost_on_time() is None
    train.press(T0 + 2)
    assert train.remaining[WHITE] == 5_000 and train.running == BLACK
    assert mk({"kind": "unlimited"}).time_left(WHITE, T0 + 999) is None


PHYS = {"kind": "standard", "stages": [{"base_ms": 60_000}],
        "physical": {"enabled": True, "per_move_allowance_ms": 8_000, "start_delay_ms": 3_000, "pause_for_sync": True,
                     "sync_cap_ms": 20_000}}


def test_human_physical_move_allowance_applies_only_to_the_human_on_a_non_robotic_board():
    c = mk(PHYS, human_sides=[WHITE], physical_active=True, robot_active=False)
    assert c.allowance_applies(WHITE) and not c.allowance_applies(BLACK)
    info = c.press(T0 + 10)                       # 3 s grace, 7 s charged, +8 s allowance
    assert info["charged_ms"] == 7000 and info["added_ms"] == 8000 and c.remaining[WHITE] == 61_000
    c.press(T0 + 20)                              # engine: no grace, no allowance
    assert c.remaining[BLACK] == 50_000
    no_board = mk(PHYS, human_sides=[WHITE], physical_active=False)
    no_board.press(T0 + 10)
    assert no_board.remaining[WHITE] == 50_000
    robot = mk(PHYS, human_sides=[WHITE], physical_active=True, robot_active=True)
    assert not robot.allowance_applies(WHITE)     # only_without_robot (default): Chessnut Move executes moves itself
    both = mk({**PHYS, "physical": {**PHYS["physical"], "applies_to": "both"}}, human_sides=[WHITE], physical_active=True)
    assert both.allowance_applies(BLACK)


def test_sync_pause_freezes_the_clock_up_to_its_cap():
    c = mk({**PHYS, "physical": {**PHYS["physical"], "start_delay_ms": 0, "per_move_allowance_ms": 0}}, human_sides=[WHITE], physical_active=True)
    c.hold("sync", T0, cap_ms=20_000)
    assert c.time_left(WHITE, T0 + 15) == 60_000 and c.snapshot(T0 + 15)["frozen"]
    c.release("sync", T0 + 15)
    assert c.time_left(WHITE, T0 + 18) == 57_000
    d = mk({**PHYS, "physical": {**PHYS["physical"], "start_delay_ms": 0}}, human_sides=[WHITE], physical_active=True)
    d.hold("sync", T0, cap_ms=20_000)
    assert d.time_left(WHITE, T0 + 50) == 60_000 - 30_000      # cap reached after 20 s: the clock runs again


def test_overlapping_holds_are_counted_once_and_setup_allowance_starts_held():
    c = mk({"kind": "standard", "stages": [{"base_ms": 60_000}]})
    c.hold("robot", T0 + 1)
    c.pause(T0 + 2)
    c.release("robot", T0 + 5)
    c.resume(T0 + 9)
    assert c.time_left(WHITE, T0 + 10) == 60_000 - 2_000        # ran for 1 s before and 1 s after the holds
    s = mk({"kind": "standard", "stages": [{"base_ms": 60_000}], "physical": {"enabled": True, "setup_allowance_ms": 30_000}},
           human_sides=[WHITE], physical_active=True)
    assert "setup" in s.holds and s.time_left(WHITE, T0 + 10) == 60_000


def test_engine_thinking_only_override_and_adjust_and_serialisation():
    c = mk({"kind": "standard", "stages": [{"base_ms": 60_000, "increment_ms": 1000}], "robot": {"policy": "engine_thinking_only"}})
    info = c.press(T0 + 9, charged_override_ms=2_500)           # 9 s wall clock, but the engine searched 2.5 s
    assert info["charged_ms"] == 2500 and c.remaining[WHITE] == 58_500
    c.adjust(BLACK, -10_000, T0 + 9)
    assert c.remaining[BLACK] == 50_000
    again = Clock.from_dict(c.to_dict())
    assert again.time_left(BLACK, T0 + 12) == c.time_left(BLACK, T0 + 12) == 47_000
    args = again.engine_limit_args(T0 + 12)
    assert abs(args["black_clock"] - 47.0) < 1e-6 and args["white_inc"] == 1.0


def test_asymmetric_time_odds_and_all_presets_are_valid():
    c = mk({"kind": "standard", "white": [{"base_ms": 300_000}], "black": [{"base_ms": 60_000}]})
    assert c.remaining == {WHITE: 300_000.0, BLACK: 60_000.0}
    for p in PRESETS:
        cfg = normalize_config(p)
        assert cfg["kind"] in ("unlimited", "standard", "hourglass", "per_move", "correspondence")
    names = [p["name"] for p in PRESETS]
    assert any("hand-move allowance" in n for n in names)
