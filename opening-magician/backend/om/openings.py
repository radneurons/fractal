"""Built-in opening knowledge: an authored catalogue of named lines, family-level plans,
pawn structures and classic traps.  Every line is validated against the rules engine at
import time (illegal data fails loudly in the test-suite rather than misleading a learner).

The catalogue also seeds the "Opening Magician Reference" book and powers opening-name
detection (deepest catalogued position along a game wins).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import chess
from .chessx import parse_move

from .chessx import pos_key

# (ECO, name, SAN line, one-line idea)
LINES: list[tuple[str, str, str, str]] = [
    # --- Open games ---------------------------------------------------------
    ("C20", "King's Pawn Game", "e4 e5", "Both sides stake a claim in the centre and open lines for the bishops and queen."),
    ("C23", "Bishop's Opening", "e4 e5 Bc4", "The bishop eyes f7 at once and White keeps the f-pawn free for a later f4."),
    ("C25", "Vienna Game", "e4 e5 Nc3", "White supports e4 and prepares f4 — a King's Gambit with the knight already developed."),
    ("C27", "Vienna Game: Frankenstein-Dracula Variation", "e4 e5 Nc3 Nf6 Bc4 Nxe4 Qh5 Nd6 Bb3 Nc6 Nb5 g6 Qf3 f5 Qd5 Qe7 Nxc7+ Kd8 Nxa8 b6",
     "Black gives a whole rook for a lasting initiative against White's stranded knight and queen."),
    ("C30", "King's Gambit", "e4 e5 f4", "White offers the f-pawn to deflect e5, build a big centre and open the f-file."),
    ("C33", "King's Gambit Accepted: Bishop's Gambit", "e4 e5 f4 exf4 Bc4", "White allows ...Qh4+ and plays for rapid development and the f-file."),
    ("C34", "King's Gambit Accepted: King's Knight Gambit", "e4 e5 f4 exf4 Nf3", "Nf3 stops ...Qh4+ and prepares d4 and Bxf4."),
    ("C31", "King's Gambit Declined: Falkbeer Countergambit", "e4 e5 f4 d5", "Black strikes back in the centre instead of taking, fighting for the initiative."),
    ("C40", "Latvian Gambit", "e4 e5 Nf3 f5", "A risky mirror-image King's Gambit; objectively dubious but full of tactics."),
    ("C41", "Philidor Defense", "e4 e5 Nf3 d6", "Solid but passive: Black props up e5 and accepts a little less space."),
    ("C42", "Petrov's Defense", "e4 e5 Nf3 Nf6", "Black counterattacks e4 rather than defending e5 — symmetrical and very solid."),
    ("C42", "Petrov's Defense: Classical Attack", "e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3", "White develops with tempo against the advanced e4-knight."),
    ("C44", "Ponziani Opening", "e4 e5 Nf3 Nc6 c3", "White prepares d4, but the c3-pawn takes the knight's best square."),
    ("C44", "Scotch Game", "e4 e5 Nf3 Nc6 d4", "White opens the centre immediately and gains free piece play."),
    ("C45", "Scotch Game: Classical", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4", "A centralised knight and open lines in return for releasing the central tension."),
    ("C45", "Scotch Game: Mieses Variation", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4",
     "White's e5-pawn cramps Black; both queens block their bishops and precise play is needed."),
    ("C46", "Four Knights Game", "e4 e5 Nf3 Nc6 Nc3 Nf6", "Sound, symmetrical development; the fight is deferred to the middlegame."),
    ("C47", "Four Knights Game: Scotch Variation", "e4 e5 Nf3 Nc6 Nc3 Nf6 d4", "A Scotch with knights developed — open and easy to play."),
    ("C48", "Four Knights Game: Spanish Variation", "e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5", "Ruy Lopez ideas with a knight already on c3."),
    ("C50", "Italian Game", "e4 e5 Nf3 Nc6 Bc4", "The bishop targets f7 and White prepares c3 and d4 or a slow d3 build-up."),
    ("C50", "Italian Game: Giuoco Pianissimo", "e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6 c3 d6 O-O O-O",
     "A slow manoeuvring game: Re1, Nbd2-f1-g3 and a timely d4 or a4-a5 expansion."),
    ("C53", "Italian Game: Giuoco Piano", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+",
     "White builds the ideal centre; Black must hit it at once with ...Bb4+ and ...d5."),
    ("C51", "Italian Game: Evans Gambit", "e4 e5 Nf3 Nc6 Bc4 Bc5 b4", "A pawn for time: c3 and d4 come with tempo against the bishop."),
    ("C55", "Italian Game: Two Knights Defense", "e4 e5 Nf3 Nc6 Bc4 Nf6", "Black counterattacks e4 and invites the sharp Ng5 lines."),
    ("C57", "Italian Game: Fried Liver Attack", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3",
     "White sacrifices a knight to drag the king to e6; Black should prefer 5...Na5."),
    ("C58", "Italian Game: Two Knights, Main Line", "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6",
     "Black gives a pawn for development and gains time on the bishop and the g5-knight."),
    ("C60", "Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5", "Pressure on the knight that defends e5: long-term central and queenside pressure."),
    ("C63", "Ruy Lopez: Schliemann Defense", "e4 e5 Nf3 Nc6 Bb5 f5", "A sharp counter-gambit attacking e4 from the flank."),
    ("C65", "Ruy Lopez: Berlin Defense", "e4 e5 Nf3 Nc6 Bb5 Nf6", "Black attacks e4 at once; famous for the rock-solid Berlin endgame."),
    ("C67", "Ruy Lopez: Berlin Endgame", "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8",
     "Queens are off: White has a kingside majority, Black the bishop pair and a fortress-like setup."),
    ("C68", "Ruy Lopez: Exchange Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6", "White gives the bishop pair to damage Black's structure and aims for a favourable pawn ending."),
    ("C70", "Ruy Lopez: Morphy Defense", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4", "The bishop keeps the pin option; ...b5 is available to Black at any moment."),
    ("C78", "Ruy Lopez: Arkhangelsk Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bb7", "Black develops the bishop actively on the long diagonal."),
    ("C80", "Ruy Lopez: Open Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5 dxe5 Be6",
     "Black grabs e4 and gets active pieces at the price of a slightly loose structure."),
    ("C84", "Ruy Lopez: Closed Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3",
     "The classical tabiya: White prepares d4, Black chooses a plan (Chigorin, Breyer, Zaitsev)."),
    ("C89", "Ruy Lopez: Marshall Attack", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 c6",
     "A pawn sacrifice for a durable kingside initiative with ...Bd6 and ...Qh4."),
    ("C92", "Ruy Lopez: Zaitsev Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Bb7 d4 Re8",
     "Maximum pressure on e4; Black keeps the position flexible and tense."),
    ("C95", "Ruy Lopez: Breyer Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7",
     "The knight reroutes to d7 to support e5 and free the c-pawn and the b7-bishop."),
    ("C96", "Ruy Lopez: Chigorin Variation", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7",
     "Black gains queenside space with ...c5 while holding e5."),
    # --- Sicilian -----------------------------------------------------------
    ("B20", "Sicilian Defense", "e4 c5", "Black fights for d4 from the flank and creates an asymmetrical, unbalanced game."),
    ("B21", "Sicilian Defense: Smith-Morra Gambit", "e4 c5 d4 cxd4 c3", "A pawn for fast development and open c- and d-files."),
    ("B22", "Sicilian Defense: Alapin Variation", "e4 c5 c3", "White prepares d4 with a pawn recapture, sidestepping the Open Sicilian."),
    ("B23", "Sicilian Defense: Closed", "e4 c5 Nc3", "White keeps the centre closed and often attacks with g3, Bg2, f4."),
    ("B27", "Sicilian Defense: Open (2.Nf3)", "e4 c5 Nf3", "The main road: White prepares d4 to open the position."),
    ("B30", "Sicilian Defense: Rossolimo Variation", "e4 c5 Nf3 Nc6 Bb5", "Positional pressure: White may double Black's pawns and plays without d4."),
    ("B51", "Sicilian Defense: Moscow Variation", "e4 c5 Nf3 d6 Bb5+", "A low-theory check that trades a pair of minor pieces or gains time."),
    ("B33", "Sicilian Defense: Sveshnikov Variation", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6",
     "Black accepts a hole on d5 for active pieces and dynamic counterplay."),
    ("B35", "Sicilian Defense: Accelerated Dragon", "e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6", "Black fianchettoes without ...d6, hoping for ...d5 in one move."),
    ("B41", "Sicilian Defense: Kan Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6", "A flexible setup that keeps every piece's options open."),
    ("B44", "Sicilian Defense: Taimanov Variation", "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6", "Flexible development with ...Qc7 and a later choice of pawn structure."),
    ("B60", "Sicilian Defense: Richter-Rauzer", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5", "White pins and prepares Qd2 and long castling."),
    ("B70", "Sicilian Defense: Dragon Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6", "The Dragon bishop on g7 breathes fire along the long diagonal."),
    ("B76", "Sicilian Defense: Dragon, Yugoslav Attack", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6",
     "Opposite-side castling and a race: h4-h5 against ...Rc8 and the c-file."),
    ("B80", "Sicilian Defense: Scheveningen Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6", "The small centre d6/e6: solid, flexible and hard to crack."),
    ("B90", "Sicilian Defense: Najdorf Variation", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "...a6 controls b5 and prepares ...e5 or ...b5: the most flexible Sicilian."),
    ("B90", "Sicilian Defense: Najdorf, English Attack", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3",
     "White plays Qd2, O-O-O and g4; Black counters on the queenside."),
    ("B96", "Sicilian Defense: Najdorf, 6.Bg5", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4", "The sharpest test, leading to the Poisoned Pawn and other forcing lines."),
    # --- French / Caro / others ----------------------------------------------
    ("C00", "French Defense", "e4 e6", "Black prepares ...d5 and accepts a cramped light-squared bishop for a solid centre."),
    ("C01", "French Defense: Exchange Variation", "e4 e6 d4 d5 exd5 exd5", "A symmetrical structure; activity decides."),
    ("C02", "French Defense: Advance Variation", "e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3", "White gains space; Black attacks the base of the chain at d4."),
    ("C03", "French Defense: Tarrasch Variation", "e4 e6 d4 d5 Nd2", "The knight avoids the Winawer pin and keeps c3 available."),
    ("C10", "French Defense: Rubinstein Variation", "e4 e6 d4 d5 Nc3 dxe4 Nxe4", "Black gives up the centre for a solid, simplified position."),
    ("C11", "French Defense: Classical Variation", "e4 e6 d4 d5 Nc3 Nf6", "Black increases the pressure on e4 and invites e5 or Bg5."),
    ("C15", "French Defense: Winawer Variation", "e4 e6 d4 d5 Nc3 Bb4", "The pin on c3 creates imbalance: Black often gives the bishop for doubled c-pawns."),
    ("C18", "French Defense: Winawer, Main Line", "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7",
     "White has the bishops and kingside space; Black has the better structure and queenside play."),
    ("B10", "Caro-Kann Defense", "e4 c6", "Black prepares ...d5 while keeping the c8-bishop's diagonal open."),
    ("B12", "Caro-Kann Defense: Advance Variation", "e4 c6 d4 d5 e5 Bf5", "Black develops the bishop outside the chain before playing ...e6."),
    ("B13", "Caro-Kann Defense: Exchange Variation", "e4 c6 d4 d5 exd5 cxd5", "A Carlsbad structure with colours reversed."),
    ("B14", "Caro-Kann Defense: Panov Attack", "e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3", "White accepts an isolated queen's pawn for active piece play."),
    ("B17", "Caro-Kann Defense: Karpov Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7", "Black prepares ...Ngf6 without allowing doubled pawns."),
    ("B18", "Caro-Kann Defense: Classical Variation", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6", "Sound development; White gains space with h4-h5."),
    ("B01", "Scandinavian Defense", "e4 d5", "Black challenges e4 immediately at the cost of time with the queen or knight."),
    ("B01", "Scandinavian Defense: Main Line", "e4 d5 exd5 Qxd5 Nc3 Qa5", "The queen sits safely on a5 and Black builds a Caro-Kann-like structure."),
    ("B01", "Scandinavian Defense: Modern Variation", "e4 d5 exd5 Nf6", "Black recaptures with the knight, sometimes gambiting the pawn."),
    ("B02", "Alekhine's Defense", "e4 Nf6", "Black tempts White's pawns forward to attack them later."),
    ("B03", "Alekhine's Defense: Four Pawns Attack", "e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 f4", "White takes the whole centre; Black must undermine it quickly."),
    ("B06", "Modern Defense", "e4 g6", "Black lets White build a centre and strikes at it from the flanks."),
    ("B07", "Pirc Defense", "e4 d6 d4 Nf6 Nc3 g6", "A hypermodern setup: ...Bg7, ...O-O, then ...e5 or ...c5."),
    ("B09", "Pirc Defense: Austrian Attack", "e4 d6 d4 Nf6 Nc3 g6 f4", "White builds a three-pawn centre and prepares e5."),
    ("B00", "Nimzowitsch Defense", "e4 Nc6", "An offbeat defence that often transposes after ...e5 or ...d5."),
    ("B00", "Owen's Defense", "e4 b6", "Black fianchettoes the queen's bishop to pressure e4."),
    # --- Closed games ----------------------------------------------------------
    ("D00", "Queen's Pawn Game", "d4 d5", "A closed centre: the c-pawns usually decide the character of the game."),
    ("D00", "London System", "d4 d5 Bf4", "A system opening: Bf4, e3, c3, Nf3, Bd3 against almost anything."),
    ("D02", "London System: Main Line", "d4 d5 Nf3 Nf6 Bf4", "Solid development with the dark-squared bishop outside the pawn chain."),
    ("D01", "Veresov Attack", "d4 d5 Nc3 Nf6 Bg5", "White plays for a quick e4 with pieces rather than c4."),
    ("D05", "Colle System", "d4 d5 Nf3 Nf6 e3 e6 Bd3", "White aims for e4 after Nbd2 and O-O."),
    ("D06", "Queen's Gambit", "d4 d5 c4", "White offers a wing pawn to deflect d5 and take the centre."),
    ("D07", "Queen's Gambit: Chigorin Defense", "d4 d5 c4 Nc6", "Piece pressure on d4 instead of a pawn chain."),
    ("D08", "Queen's Gambit: Albin Countergambit", "d4 d5 c4 e5", "Black gambits a pawn to drive a wedge to d4."),
    ("D10", "Slav Defense", "d4 d5 c4 c6", "Black supports d5 while keeping the c8-bishop free."),
    ("D15", "Slav Defense: Main Line", "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5", "Black takes on c4 and develops the bishop before ...e6."),
    ("D20", "Queen's Gambit Accepted", "d4 d5 c4 dxc4", "Black takes the pawn, intending to return it for free development."),
    ("D26", "Queen's Gambit Accepted: Classical", "d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O", "Black hits d4 with ...c5; isolated-pawn positions are common."),
    ("D30", "Queen's Gambit Declined", "d4 d5 c4 e6", "A rock-solid centre; the c8-bishop is the long-term problem piece."),
    ("D32", "Queen's Gambit Declined: Tarrasch Defense", "d4 d5 c4 e6 Nc3 c5", "Black accepts an isolated pawn for free piece play."),
    ("D35", "Queen's Gambit Declined: Exchange Variation", "d4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5", "The Carlsbad structure: minority attack with b4-b5 or central play with f3 and e4."),
    ("D37", "Queen's Gambit Declined: 5.Bf4", "d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bf4", "A modern main line keeping the bishop active on f4."),
    ("D53", "Queen's Gambit Declined: Orthodox", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3", "Classical development for both sides."),
    ("D58", "Queen's Gambit Declined: Tartakower", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6", "Black solves the bishop problem with ...b6 and ...Bb7."),
    ("D43", "Semi-Slav Defense", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6", "A flexible, resilient triangle with sharp gambit possibilities."),
    ("D44", "Semi-Slav Defense: Botvinnik System", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 Bg5 dxc4 e4 b5", "One of the wildest lines in all of opening theory."),
    ("D47", "Semi-Slav Defense: Meran Variation", "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5", "Black gains queenside space with tempo and prepares ...c5."),
    ("A45", "Trompowsky Attack", "d4 Nf6 Bg5", "White threatens to damage Black's structure on move two."),
    ("A46", "Torre Attack", "d4 Nf6 Nf3 e6 Bg5", "A system with Bg5, e3, Nbd2 and c3."),
    ("A80", "Dutch Defense", "d4 f5", "Black controls e4 and plays for a kingside attack."),
    ("A87", "Dutch Defense: Leningrad Variation", "d4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6", "A King's Indian with the f-pawn already advanced."),
    ("A90", "Dutch Defense: Stonewall", "d4 f5 c4 Nf6 g3 e6 Bg2 d5", "A wall on the light squares; e5 becomes the key outpost for White."),
    ("A40", "Englund Gambit", "d4 e5", "An unsound pawn sacrifice with a few well-known traps."),
    # --- Indian defences -------------------------------------------------------
    ("E00", "Catalan Opening", "d4 Nf6 c4 e6 g3", "Queen's Gambit pressure combined with a fianchettoed bishop on the long diagonal."),
    ("E04", "Catalan Opening: Open", "d4 Nf6 c4 e6 g3 d5 Bg2 dxc4 Nf3", "Black takes on c4; White relies on long-term pressure to regain it."),
    ("E06", "Catalan Opening: Closed", "d4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O", "Black keeps the centre closed and develops solidly."),
    ("E11", "Bogo-Indian Defense", "d4 Nf6 c4 e6 Nf3 Bb4+", "A solid check that trades or misplaces a white minor piece."),
    ("E12", "Queen's Indian Defense", "d4 Nf6 c4 e6 Nf3 b6", "Black controls e4 with pieces from afar."),
    ("E15", "Queen's Indian Defense: Fianchetto", "d4 Nf6 c4 e6 Nf3 b6 g3 Ba6", "The bishop goes to a6 to annoy the c4-pawn."),
    ("E20", "Nimzo-Indian Defense", "d4 Nf6 c4 e6 Nc3 Bb4", "The pin fights for e4; Black often takes on c3 to double White's pawns."),
    ("E32", "Nimzo-Indian Defense: Classical", "d4 Nf6 c4 e6 Nc3 Bb4 Qc2", "White avoids doubled pawns at the cost of development."),
    ("E40", "Nimzo-Indian Defense: Rubinstein", "d4 Nf6 c4 e6 Nc3 Bb4 e3", "Calm development; the structure is decided later."),
    ("E60", "King's Indian Defense", "d4 Nf6 c4 g6", "Black lets White have the centre and counterattacks it with ...e5 or ...c5."),
    ("E76", "King's Indian Defense: Four Pawns Attack", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4", "The most ambitious centre; it can become a target."),
    ("E80", "King's Indian Defense: Sämisch Variation", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3", "f3 supports e4 and prepares Be3, Qd2 and a kingside pawn storm."),
    ("E92", "King's Indian Defense: Classical", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5", "The main line: tension in the centre, often resolved by d5."),
    ("E97", "King's Indian Defense: Mar del Plata", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7",
     "A race: White attacks on the queenside, Black throws everything at the king."),
    ("D80", "Grünfeld Defense", "d4 Nf6 c4 g6 Nc3 d5", "Black invites a big white centre and then attacks it."),
    ("D85", "Grünfeld Defense: Exchange Variation", "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7", "White's centre against Black's pressure on d4 with ...c5 and ...Nc6."),
    ("A52", "Budapest Gambit", "d4 Nf6 c4 e5", "A pawn sacrifice for quick piece play against e5."),
    ("A53", "Old Indian Defense", "d4 Nf6 c4 d6", "A solid cousin of the King's Indian with the bishop on e7."),
    ("A57", "Benko Gambit", "d4 Nf6 c4 c5 d5 b5", "A positional pawn sacrifice for lasting queenside pressure."),
    ("A60", "Modern Benoni", "d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6", "Black accepts a space disadvantage for a queenside majority and active pieces."),
    # --- Flank openings ----------------------------------------------------------
    ("A10", "English Opening", "c4", "A flexible flank opening controlling d5; frequently transposes."),
    ("A15", "English Opening: Anglo-Indian", "c4 Nf6", "Both sides keep their central pawns flexible."),
    ("A20", "English Opening: Reversed Sicilian", "c4 e5", "White plays a Sicilian with an extra tempo."),
    ("A30", "English Opening: Symmetrical", "c4 c5", "Symmetry that one side must break, usually with d4 or ...d5."),
    ("A04", "Réti Opening", "Nf3", "Flexible development that keeps every central pawn option open."),
    ("A07", "King's Indian Attack", "Nf3 d5 g3", "A universal setup: g3, Bg2, O-O, d3, Nbd2 and e4."),
    ("A09", "Réti Opening: Réti Gambit", "Nf3 d5 c4", "Flank pressure on d5 in hypermodern style."),
    ("A01", "Nimzo-Larsen Attack", "b3", "The queen's bishop takes the long diagonal at once."),
    ("A02", "Bird's Opening", "f4", "White controls e5: a Dutch Defense with an extra move."),
    ("A02", "Bird's Opening: From's Gambit", "f4 e5", "Black sacrifices a pawn to exploit the weakened e1-h4 diagonal."),
    ("A03", "Bird's Opening: Dutch Variation", "f4 d5", "The classical reply, taking the centre."),
    ("A00", "Polish Opening", "b4", "Queenside space and a bishop on b2; offbeat but playable."),
    ("A00", "Grob Opening", "g4", "A provocative flank advance that weakens the kingside."),
]

# Family-level teaching content (matched by name prefix).
FAMILIES: dict[str, dict[str, Any]] = {
    "Ruy Lopez": {"white": ["Castle, play c3 and d4 to build the centre", "Reroute Nb1-d2-f1-g3", "Squeeze on the queenside with a4"],
                  "black": ["Hold e5 and complete development with ...Be7, ...O-O", "Gain space with ...b5 and ...c5", "Free the game with ...d5 when White is slow"],
                  "structure": "Closed centre with tension on e4/e5; the d4 break is White's key lever.", "squares": ["e5", "d4", "f5", "b5"]},
    "Italian Game": {"white": ["c3 and d4 to take the centre, or slow d3 manoeuvring", "Pressure f7 with Bc4 and a kingside knight"],
                     "black": ["Counter in the centre with ...d5", "Keep the c5-bishop safe from d4 with tempo"],
                     "structure": "Symmetrical e-pawns; whoever achieves d4/...d5 under good conditions gets the initiative.", "squares": ["f7", "d4", "d5"]},
    "Sicilian Defense": {"white": ["Open the centre with d4 and use the lead in development", "Attack on the kingside before Black's queenside play lands"],
                         "black": ["Use the half-open c-file and the central pawn majority", "Counterattack with ...b5 and pressure e4"],
                         "structure": "Asymmetrical: White has a d-file and space, Black an extra central pawn and the c-file.", "squares": ["d5", "d4", "c4", "e4"]},
    "French Defense": {"white": ["Use the space advantage on the kingside", "Defend the d4 base of the pawn chain"],
                       "black": ["Attack the chain with ...c5 and ...f6", "Solve the problem of the c8-bishop"],
                       "structure": "Chain e5-d4 against e6-d5: play on the side where your pawns point.", "squares": ["d4", "e5", "c5", "f6"]},
    "Caro-Kann Defense": {"white": ["Use the space advantage and easier development", "Advance h4-h5 against a bishop on g6"],
                          "black": ["Develop the c8-bishop before ...e6", "Break with ...c5 once development is complete"],
                          "structure": "Solid c6/e6 structure; Black is slightly passive but has no weaknesses.", "squares": ["d5", "e4", "c5"]},
    "Queen's Gambit": {"white": ["Pressure d5 with Nc3, Bg5, Qc2", "Minority attack with b4-b5 in the Exchange structure"],
                       "black": ["Free the position with ...c5 or ...e5", "Activate or exchange the c8-bishop"],
                       "structure": "d4/c4 against d5/e6 (or c6): everything revolves around the d5 point.", "squares": ["d5", "c4", "e5", "c5"]},
    "Slav Defense": {"white": ["Regain c4 and build a centre with e4", "Use the a4 lever against ...b5"],
                     "black": ["Develop the c8-bishop actively", "Hold the extra pawn only if it costs White time"],
                     "structure": "c6-d5 triangle; the light-squared bishop decides how comfortable Black is.", "squares": ["d5", "c4", "e4"]},
    "Semi-Slav Defense": {"white": ["Play e4 to open the centre", "Use the bishop pair after ...dxc4 lines"],
                          "black": ["...dxc4 and ...b5 to gain space", "Break with ...c5 or ...e5"],
                          "structure": "Triangle c6-d5-e6: solid but the c8-bishop needs a plan.", "squares": ["d5", "c4", "e4", "b5"]},
    "King's Indian Defense": {"white": ["Queenside expansion with c5 and b4", "Keep the kingside closed as long as possible"],
                              "black": ["...f5-f4 and a pawn storm against the king", "Reroute pieces to g6, f6, h5"],
                              "structure": "Locked centre d5/e4 against d6/e5: opposite-wing attacks.", "squares": ["d5", "e5", "f5", "c5"]},
    "Nimzo-Indian Defense": {"white": ["Build a centre with f3/e4 or Qc2/e4", "Use the bishop pair in an open position"],
                             "black": ["Blockade and attack the doubled c-pawns", "Control e4 with pieces"],
                             "structure": "Often doubled white c-pawns versus the bishop pair.", "squares": ["e4", "c4", "d5"]},
    "Grünfeld Defense": {"white": ["Maintain and advance the centre", "Create a passed d-pawn"],
                         "black": ["Hit d4 with ...c5, ...Nc6, ...Bg4", "Use the queenside majority in endings"],
                         "structure": "White centre c3-d4-e4 against piece pressure.", "squares": ["d4", "c5", "c3"]},
    "London System": {"white": ["Bf4, e3, c3, Bd3, Nbd2 and a kingside build-up", "Ne5 followed by f4 in many lines"],
                      "black": ["Challenge the bishop with ...Bd6 or ...Nh5", "Play ...c5 and ...Qb6 against b2"],
                      "structure": "Solid pyramid c3-d4-e3.", "squares": ["e5", "b2", "c5"]},
    "English Opening": {"white": ["Fianchetto and control d5", "Queenside expansion with Rb1 and b4"],
                        "black": ["Occupy the centre with ...e5 or ...d5", "Mirror with a reversed setup"],
                        "structure": "Flexible; often a reversed Sicilian.", "squares": ["d5", "e4", "b4"]},
    "Dutch Defense": {"white": ["Fianchetto and prepare e4", "Exploit the weakened e6/e5 squares"],
                      "black": ["Kingside attack with ...Qe8-h5", "Control e4"],
                      "structure": "f5 gives space but loosens the king.", "squares": ["e4", "e5", "e6"]},
}
DEFAULT_FAMILY = {"white": ["Develop quickly and fight for the centre", "Castle and connect the rooks"],
                  "black": ["Equalise in the centre before seeking activity", "Complete development and castle"],
                  "structure": "See the resulting pawn structure after the first central exchange.", "squares": ["e4", "d4", "e5", "d5"]}

# name, parent opening, full SAN line in which the victim falls for it, side that springs the trap,
# 0-based ply of the tempting mistake, explanation
TRAPS: list[dict[str, Any]] = [
    {"name": "Légal Trap", "opening": "Philidor Defense", "side": "white", "blunder_ply": 9,
     "moves": "e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#",
     "explanation": "White's knight ignores the pin. If Black takes the queen, Bxf7+ and Nd5 give mate with three minor pieces."},
    {"name": "Scholar's Mate", "opening": "King's Pawn Game", "side": "white", "blunder_ply": 5,
     "moves": "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#",
     "explanation": "Queen and bishop both aim at f7. ...Nf6 attacks the queen but forgets f7; ...g6 or ...Qe7 defends."},
    {"name": "Blackburne Shilling Gambit", "opening": "Italian Game", "side": "black", "blunder_ply": 6,
     "moves": "e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#",
     "explanation": "Taking on e5 looks free, but ...Qg5 forks the knight and g2 and the attack ends in a smothered mate."},
    {"name": "Noah's Ark Trap", "opening": "Ruy Lopez", "side": "black", "blunder_ply": 14,
     "moves": "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 d6 d4 b5 Bb3 Nxd4 Nxd4 exd4 Qxd4 c5 Qd5 Be6 Qc6+ Bd7 Qd5 c4",
     "explanation": "After Qxd4 the queenside pawns roll forward with tempo and the b3-bishop is entombed."},
    {"name": "Fishing Pole Trap", "opening": "Ruy Lopez: Berlin Defense", "side": "black", "blunder_ply": 10,
     "moves": "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Ng4 h3 h5 hxg4 hxg4 Ne1 Qh4 f3 g3",
     "explanation": "Taking the knight opens the h-file: ...Qh4 and ...g3 create an unstoppable mating net around h2."},
    {"name": "Mortimer Trap", "opening": "Ruy Lopez: Berlin Defense", "side": "black", "blunder_ply": 8,
     "moves": "e4 e5 Nf3 Nc6 Bb5 Nf6 d3 Ne7 Nxe5 c6 Ba4 Qa5+",
     "explanation": "...Ne7 looks like a blunder of e5, but ...c6 hits the bishop and ...Qa5+ then forks king and knight."},
    {"name": "Petrov Copycat Trap", "opening": "Petrov's Defense", "side": "white", "blunder_ply": 5,
     "moves": "e4 e5 Nf3 Nf6 Nxe5 Nxe4 Qe2 Nf6 Nc6+",
     "explanation": "Copying White with ...Nxe4 fails: after Qe2 the knight is pinned to trouble and Nc6+ wins the queen."},
    {"name": "Siberian Trap", "opening": "Sicilian Defense: Smith-Morra Gambit", "side": "black", "blunder_ply": 16,
     "moves": "e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 e6 Bc4 Qc7 O-O Nf6 Qe2 Ng4 h3 Nd4",
     "explanation": "The natural h3 loses: ...Nd4 removes the f3 defender, and Nxd4 allows ...Qh2 mate."},
    {"name": "Magnus Smith Trap", "opening": "Sicilian Defense", "side": "white", "blunder_ply": 15,
     "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bc4 g6 Nxc6 bxc6 e5 dxe5 Bxf7+",
     "explanation": "After ...dxe5 the queen on d8 is only defended by the king: Bxf7+ deflects it and wins the queen."},
    {"name": "Caro-Kann Smothered Mate", "opening": "Caro-Kann Defense: Karpov Variation", "side": "white", "blunder_ply": 9,
     "moves": "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Qe2 Ngf6 Nd6#",
     "explanation": "Qe2 sets a trap on the e-file: the e7-pawn is pinned, so the knight check on d6 is mate."},
    {"name": "Elephant Trap", "opening": "Queen's Gambit Declined", "side": "black", "blunder_ply": 10,
     "moves": "d4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 cxd5 exd5 Nxd5 Nxd5 Bxd8 Bb4+ Qd2 Bxd2+ Kxd2 Kxd8",
     "explanation": "The f6-knight is not really pinned: after ...Nxd5 Bxd8 Bb4+ White must give back the queen and stays a piece down."},
    {"name": "Lasker Trap", "opening": "Queen's Gambit: Albin Countergambit", "side": "black", "blunder_ply": 6,
     "moves": "d4 d5 c4 e5 dxe5 d4 e3 Bb4+ Bd2 dxe3 Bxb4 exf2+ Ke2 fxg1=N+ Rxg1 Bg4+",
     "explanation": "e3 allows a famous under-promotion: ...fxg1=N+ wins material because taking allows ...Bg4+ skewering the queen."},
    {"name": "Queen's Gambit Accepted ...b5 Trap", "opening": "Queen's Gambit Accepted", "side": "white", "blunder_ply": 9,
     "moves": "d4 d5 c4 dxc4 e3 b5 a4 c6 axb5 cxb5 Qf3",
     "explanation": "Clinging to the c4-pawn with ...b5 and ...c6 backfires: after the exchange on b5, Qf3 attacks the a8-rook, which cannot be saved."},
    {"name": "Englund Gambit Trap", "opening": "Englund Gambit", "side": "black", "blunder_ply": 10,
     "moves": "d4 e5 dxe5 Nc6 Nf3 Qe7 Bf4 Qb4+ Bd2 Qxb2 Bc3 Bb4 Qd2 Bxc3 Qxc3 Qc1#",
     "explanation": "Bc3 tries to trap the queen but ...Bb4 pins it; the back rank then collapses to ...Qc1 mate."},
    {"name": "Kieninger Trap", "opening": "Budapest Gambit", "side": "black", "blunder_ply": 14,
     "moves": "d4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+ Nbd2 Qe7 a3 Ngxe5 axb4 Nd3#",
     "explanation": "The e2-pawn is pinned by the queen on e7, so after axb4 the knight lands on d3 with a smothered mate."},
    {"name": "Rubinstein Trap", "opening": "Queen's Gambit Declined: Orthodox", "side": "white", "blunder_ply": 23,
     "moves": "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 Re8 Qc2 a6 cxd5 exd5 Bd3 c6 O-O Ne4 Bf4 f5 Nxd5",
     "explanation": "Nxd5 wins a pawn: recapturing with the c-pawn allows Bc7, trapping the black queen."},
]


def _parse(line: str) -> tuple[list[chess.Move], list[str], chess.Board]:
    board = chess.Board()
    moves, sans = [], []
    for tok in line.split():
        mv = board.parse_san(tok)
        sans.append(board.san(mv))
        moves.append(mv)
        board.push(mv)
    return moves, sans, board


def family_of(name: str) -> dict[str, Any]:
    for key, fam in FAMILIES.items():
        if name.startswith(key) or (key == "Queen's Gambit" and name.startswith("Queen's Gambit")):
            return {"family": key, **fam}
    return {"family": name.split(":")[0], **DEFAULT_FAMILY}


@lru_cache(maxsize=1)
def catalog() -> list[dict[str, Any]]:
    out = []
    for i, (eco, name, line, idea) in enumerate(LINES):
        moves, sans, board = _parse(line)
        fam = family_of(name)
        out.append({"id": f"op{i:03d}", "eco": eco, "name": name, "moves": sans, "uci": [m.uci() for m in moves],
                    "fen": board.fen(), "epd": pos_key(board), "plies": len(moves), "idea": idea,
                    "family": fam["family"], "plans": {"white": fam["white"], "black": fam["black"]},
                    "structure": fam["structure"], "key_squares": fam["squares"],
                    "group": _group(eco)})
    return out


def _group(eco: str) -> str:
    letter = eco[0]
    return {"A": "Flank & Indian systems", "B": "Semi-open games", "C": "Open games & French", "D": "Closed games",
            "E": "Indian defences"}[letter]


@lru_cache(maxsize=1)
def traps() -> list[dict[str, Any]]:
    out = []
    for i, t in enumerate(TRAPS):
        moves, sans, board = _parse(t["moves"])
        before = chess.Board()
        for m in moves[:t["blunder_ply"]]:
            before.push(m)
        out.append({"id": f"trap{i:02d}", "name": t["name"], "opening": t["opening"], "side": t["side"],
                    "moves": sans, "uci": [m.uci() for m in moves], "blunder_ply": t["blunder_ply"],
                    "blunder_san": sans[t["blunder_ply"]], "fen_before_blunder": before.fen(),
                    "final_fen": board.fen(), "is_mate": board.is_checkmate(), "explanation": t["explanation"],
                    "victim": "white" if t["side"] == "black" else "black"})
    return out


@lru_cache(maxsize=1)
def _name_index() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """(exact, passing): `exact` maps a position to the deepest catalogue line ending there;
    `passing` names positions that lie *inside* a catalogued line by the deepest named
    position already passed on that line — which is what makes transpositions resolve."""
    exact: dict[str, dict[str, Any]] = {}
    for op in catalog():
        cur = exact.get(op["epd"])
        if cur is None or op["plies"] >= cur["plies"]:
            exact[op["epd"]] = op
    passing: dict[str, dict[str, Any]] = {}
    for op in catalog():
        board = chess.Board()
        named = None
        for u in op["uci"]:
            board.push(chess.Move.from_uci(u))
            key = pos_key(board)
            if key in exact:
                named = exact[key]
            elif named is not None:
                cur = passing.get(key)
                if cur is None or named["plies"] > cur["plies"]:
                    passing[key] = named
    return exact, passing


def identify(board: chess.Board) -> dict[str, Any] | None:
    """Name the opening of a game: walk the move stack backwards to the deepest catalogued position."""
    exact, passing = _name_index()
    b = board.copy()
    while True:
        key = pos_key(b)
        hit = exact.get(key) or passing.get(key)
        if hit:
            return {"eco": hit["eco"], "name": hit["name"], "id": hit["id"], "plies": hit["plies"],
                    "transposed": hit["uci"][:len(b.move_stack)] != [m.uci() for m in b.move_stack][:hit["plies"]]}
        if not b.move_stack:
            return None
        b.pop()


def identify_moves(moves: list[str], start_fen: str | None = None) -> dict[str, Any] | None:
    board = chess.Board(start_fen) if start_fen else chess.Board()
    best = None
    exact, passing = _name_index()
    for u in moves:
        try:
            mv = parse_move(board, u)
        except ValueError:
            break
        board.push(mv)
        hit = exact.get(pos_key(board)) or passing.get(pos_key(board))
        if hit and (best is None or hit["plies"] >= best["depth"]):
            best = {"eco": hit["eco"], "name": hit["name"], "id": hit["id"], "plies": len(board.move_stack), "depth": hit["plies"]}
    return best


def find(opening_id: str) -> dict[str, Any] | None:
    return next((o for o in catalog() if o["id"] == opening_id), None)


def search(q: str) -> list[dict[str, Any]]:
    ql = q.lower().strip()
    return [o for o in catalog() if ql in o["name"].lower() or ql == o["eco"].lower() or ql in " ".join(o["moves"]).lower()]


def reference_book() -> "Any":
    """The catalogue as a Book graph (transpositions merged), names attached as comments."""
    from .books.model import Book
    book = Book()
    for op in catalog():
        board = chess.Board()
        for i, u in enumerate(op["uci"]):
            mv = chess.Move.from_uci(u)
            last = i == len(op["uci"]) - 1
            book.add_move(board, mv, weight=1.0, source="catalogue", comment=f"{op['eco']} {op['name']}" if last else "")
            board.push(mv)
    return book
