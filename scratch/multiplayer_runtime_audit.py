#!/usr/bin/env python3
"""Deterministic checks for host-authoritative Chat and World room state."""

from __future__ import annotations

import unittest
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import horde_mcp_bridge as bridge


class MultiplayerRuntimeAudit(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime = bridge.MultiplayerRuntime()
        self.runtime.port = 49999
        self.runtime.ensure_server = lambda: None
        created = self.runtime.create_room({
            "worldName": "Audit World", "sessionName": "Timeline",
            "displayName": "Host",
            "sheet": {"name": "Host", "attributes": {"Finesse": 1}},
            "persona": {"name": "Mara", "pronouns": "she/her", "publicIdentity": "Town medic",
                        "secret": "must-not-leak"},
            "snapshot": {"worldName": "Audit World", "sessionName": "Timeline",
                         "location": "Square", "turn": 3,
                         "hud": {"location": {"name": "Square", "description": "Market day"},
                                 "stats": [{"id": "hp", "name": "HP", "value": 8, "min": 0, "max": 10}],
                                 "outfit": "Travel cloak", "inventory": ["Map"],
                                 "apiKey": "nested-secret"},
                         "history": [{"role": "dm", "text": "Opening"}],
                         "campaignStart": {"history": [{"role": "dm", "text": "Opening"}],
                                           "turn": 3, "gameState": {"characters": {}}},
                         "apiKey": "must-not-leak"},
        })
        self.host = {
            "roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
            "playerId": created["hostPlayerId"], "playerToken": created["playerToken"],
        }
        joined = self.runtime.join({**self.host, "displayName": "Guest",
                                    "persona": {"name": "Rowan", "reputation": "Known courier"}})
        self.guest = {**self.host, "playerId": joined["playerId"],
                      "playerToken": joined["playerToken"]}

    def test_sequential_round_and_host_commit(self) -> None:
        self.runtime.submit({**self.host, "text": "Host acts"})
        with self.assertRaises(ValueError):
            self.runtime.submit({**self.host, "text": "Host acts twice"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        ready = self.runtime.state(self.host)
        self.assertEqual(ready["round"]["status"], "ready")
        self.runtime.commit({**self.host, "snapshot": {"worldName": "Audit World",
            "sessionName": "Timeline", "location": "Bridge", "turn": 4,
            "history": [{"role": "dm", "text": "Resolved"}]}})
        following = self.runtime.state(self.guest)
        self.assertEqual(following["round"]["number"], 2)
        self.assertEqual(following["round"]["activePlayerId"], self.host["playerId"])
        self.assertEqual(following["snapshot"]["history"][-1]["text"], "Resolved")

    def test_guest_cannot_commit_or_apply_vote(self) -> None:
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        with self.assertRaises(PermissionError):
            self.runtime.commit(self.guest)
        self.runtime.commit({**self.host, "snapshot": {"history": [{"role": "dm", "text": "Resolved"}]}})
        proposed = self.runtime.propose({**self.guest, "type": "reroll", "label": "Reroll"})
        self.runtime.vote({**self.host, "proposalId": proposed["proposalId"], "approve": True})
        with self.assertRaises(PermissionError):
            self.runtime.resolve_proposal(self.guest)
        self.runtime.resolve_proposal(self.host)

    def test_snapshot_is_allow_listed(self) -> None:
        state = self.runtime.state(self.guest)
        self.assertNotIn("apiKey", state["snapshot"])
        self.assertEqual(set(state["snapshot"]),
                         {"experienceType", "experienceName", "worldName", "sessionName", "location", "turn", "hud", "history", "campaignMeta", "gameState", "campaignStart"})
        self.assertNotIn("apiKey", state["snapshot"]["hud"])
        self.assertEqual(state["snapshot"]["hud"]["stats"][0]["value"], 8)
        self.assertEqual(state["snapshot"]["hud"]["inventory"], ["Map"])

    def test_players_have_distinct_public_personas_and_permissions(self) -> None:
        host_state = self.runtime.state(self.host)
        guest_state = self.runtime.state(self.guest)
        self.assertIn("commit", host_state["permissions"])
        self.assertNotIn("commit", guest_state["permissions"])
        self.assertEqual(host_state["players"][0]["persona"]["publicIdentity"], "Town medic")
        self.assertEqual(host_state["players"][1]["persona"]["reputation"], "Known courier")
        self.assertNotIn("secret", host_state["players"][0]["persona"])

    def test_chat_room_metadata_is_preserved(self) -> None:
        runtime = bridge.MultiplayerRuntime()
        runtime.port = 49998
        runtime.ensure_server = lambda: None
        created = runtime.create_room({
            "experienceType": "chat", "experienceName": "Campfire Cast",
            "sessionName": "Friday", "displayName": "Host",
            "snapshot": {"experienceType": "chat", "experienceName": "Campfire Cast",
                         "sessionName": "Friday", "history": [{"role": "dm", "text": "Hi"}]},
        })
        auth = {"roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
                "playerId": created["hostPlayerId"], "playerToken": created["playerToken"]}
        state = runtime.state(auth)
        self.assertEqual(state["experienceType"], "chat")
        self.assertEqual(state["experienceName"], "Campfire Cast")
        self.assertEqual(state["snapshot"]["experienceType"], "chat")

    def test_custom_rules_and_canonical_character_state_survive_relay(self) -> None:
        runtime = bridge.MultiplayerRuntime()
        runtime.port = 49997
        runtime.ensure_server = lambda: None
        rules = {
            "id": "custom", "name": "Neon Occult", "die": "2d8", "mode": "roll-over", "target": 11, "explode": True,
            "attributes": ["Nerve", "Chrome", "Occult"], "skills": ["Hack", "Bind", "Drive"],
            "resources": [{"id": "vitality", "name": "Vitality", "min": 0, "max": 18}],
            "slots": ["body", "implant", "weapon"],
            "progression": {"kind": "points", "maxLevel": 12, "base": 100, "curve": 1.4},
        }
        game_state = {
            "schemaVersion": 2, "revision": 7, "phase": "encounter", "rules": rules,
            "characters": {"host": {"schemaVersion": 2, "name": "Nyx", "level": 3,
                "attributes": {"Nerve": 2}, "skills": {"Hack": 4},
                "resources": {"vitality": {"id": "vitality", "name": "Vitality", "value": 9, "min": 0, "max": 18}},
                "effects": [{"id": "fx1", "name": "Overclocked", "kind": "buff", "duration": 2}],
                "inventory": [{"id": "deck", "name": "Ghost deck", "quantity": 1}], "equipment": {"implant": "deck"}}},
            "npcs": {}, "encounters": [], "quests": [], "clocks": [], "sharedInventory": [], "journal": [],
            "rolls": [], "transactions": [], "lastReceiptId": "", "updatedAt": 1,
        }
        created = runtime.create_room({"experienceType": "world", "experienceName": "Neon", "displayName": "Host",
            "snapshot": {"campaignMeta": {"id": "c1", "name": "Neon", "system": rules}, "gameState": game_state}})
        auth = {"roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
                "playerId": created["hostPlayerId"], "playerToken": created["playerToken"]}
        state = runtime.state(auth)
        system = state["snapshot"]["campaignMeta"]["system"]
        self.assertEqual(system["attributes"], ["Nerve", "Chrome", "Occult"])
        self.assertEqual(system["progression"]["kind"], "points")
        self.assertTrue(system["explode"])
        self.assertEqual(state["snapshot"]["gameState"]["characters"]["host"]["effects"][0]["name"], "Overclocked")

    def test_dice_pool_uses_stats_as_pool_size(self) -> None:
        runtime = bridge.MultiplayerRuntime()
        runtime.port = 49996
        runtime.ensure_server = lambda: None
        rules = {"id": "dice-pool", "name": "Pool", "die": "d6", "mode": "success-pool", "target": 5}
        sheet = {"name": "Scout", "attributes": {"Finesse": 2}, "skills": {"Notice": 3},
                 "effects": [], "conditions": [], "inventory": [], "equipment": {}}
        created = runtime.create_room({"displayName": "Scout", "sheet": sheet,
            "snapshot": {"campaignMeta": {"system": rules}, "gameState": {"rules": rules, "characters": {}}}})
        auth = {"roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
                "playerId": created["hostPlayerId"], "playerToken": created["playerToken"]}
        result = runtime.roll({**auth, "attribute": "Finesse", "skill": "Notice", "difficulty": 5})["roll"]
        self.assertEqual(result["poolSize"], 5)
        self.assertEqual(len(result["dice"]), 5)
        self.assertNotIn("+5", result["expression"])

    def test_host_commit_and_reset_synchronize_authoritative_sheets(self) -> None:
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        snapshot = {"gameState": {"characters": {
            self.host["playerId"]: {"name": "Host", "attributes": {"Finesse": 7},
                "skills": {"Notice": 1}, "effects": [{"modifiers": {"checks": 2}}],
                "inventory": [{"id": "amulet", "modifiers": {"checks": 3}}], "equipment": {"neck": "amulet"}}}}}
        self.runtime.commit({**self.host, "snapshot": snapshot})
        state = self.runtime.state(self.host)
        self.assertEqual(state["players"][0]["sheet"]["attributes"]["Finesse"], 7)
        rolled = self.runtime.roll({**self.host, "dice": "d2", "attribute": "Finesse", "skill": "Notice"})
        self.assertEqual(rolled["roll"]["bonus"], 13)
        vote = self.runtime.propose({**self.host, "type": "reset"})
        self.runtime.vote({**self.guest, "proposalId": vote["proposalId"], "approve": True})
        snapshot["gameState"]["characters"][self.host["playerId"]]["attributes"]["Finesse"] = 1
        self.runtime.resolve_proposal(self.host, snapshot)
        self.assertEqual(self.runtime.state(self.host)["players"][0]["sheet"]["attributes"]["Finesse"], 1)

    def test_private_notes_are_visible_to_owner_and_host(self) -> None:
        self.runtime.update_sheet({**self.host, "sheet": {"notes": "Host private"}})
        self.runtime.update_sheet({**self.guest, "sheet": {"notes": "Guest private"}})
        guest = self.runtime.state(self.guest)
        self.assertNotIn("notes", guest["players"][0]["sheet"])
        self.assertNotIn("notes", guest["snapshot"]["gameState"]["characters"][self.host["playerId"]])
        self.assertEqual(guest["snapshot"]["gameState"]["characters"][self.guest["playerId"]]["notes"], "Guest private")
        self.assertEqual(self.runtime.state(self.host)["players"][0]["sheet"]["notes"], "Host private")

    def test_join_after_ready_requires_the_new_players_submission(self) -> None:
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        late = self.runtime.join({**self.host, "displayName": "Late"})
        state = self.runtime.state(self.host)
        self.assertEqual(state["round"]["status"], "collecting")
        self.assertEqual(state["round"]["activePlayerId"], late["playerId"])
        with self.assertRaisesRegex(ValueError, "Every player"):
            self.runtime.commit({**self.host, "snapshot": {}})
        self.runtime.submit({**self.host, "playerId": late["playerId"], "playerToken": late["playerToken"], "text": "Late acts"})
        self.runtime.commit({**self.host, "snapshot": {}})
        self.assertEqual(len(self.runtime.state(self.host)["snapshot"]["gameState"]["characters"]), 3)

    def test_stale_commit_cannot_erase_a_concurrent_sheet_edit(self) -> None:
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        previous = self.runtime.state(self.host)
        self.runtime.update_sheet({**self.guest, "sheet": {"attributes": {"Finesse": 9}}})
        with self.assertRaisesRegex(ValueError, "party changed"):
            self.runtime.commit({**self.host, "snapshot": previous["snapshot"],
                "expectedRevision": previous["revision"], "expectedRoundNumber": previous["round"]["number"]})
        latest = self.runtime.state(self.host)
        self.assertEqual(latest["round"]["status"], "ready")
        self.assertEqual(latest["snapshot"]["gameState"]["characters"][self.guest["playerId"]]["attributes"]["Finesse"], 9)

    def test_reroll_restores_mechanics_and_history_even_at_the_history_limit(self) -> None:
        before = [{"role": "dm", "text": f"Before {index}"} for index in range(120)]
        self.runtime.gm_update({**self.host, "snapshot": {"history": before, "turn": 8,
            "gameState": {"characters": {self.host["playerId"]: {"attributes": {"Finesse": 4}}}}}})
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        self.runtime.commit({**self.host, "snapshot": {"history": before + [{"role": "dm", "text": "Damaged"}], "turn": 9,
            "gameState": {"characters": {self.host["playerId"]: {"attributes": {"Finesse": 1}}}}}})
        vote = self.runtime.propose({**self.host, "type": "reroll"})
        self.runtime.vote({**self.guest, "proposalId": vote["proposalId"], "approve": True})
        state = self.runtime.state(self.host)
        self.runtime.resolve_proposal({**self.host, "proposalId": vote["proposalId"], "expectedRevision": state["revision"]})
        restored = self.runtime.state(self.host)
        self.assertEqual([row["text"] for row in restored["snapshot"]["history"]], [row["text"] for row in before])
        self.assertEqual(restored["snapshot"]["turn"], 8)
        self.assertEqual(restored["snapshot"]["gameState"]["characters"][self.host["playerId"]]["attributes"]["Finesse"], 4)
        self.assertEqual(restored["round"]["status"], "ready")
        self.assertEqual(restored["round"]["number"], 1)
        self.assertEqual(restored["round"]["submissions"][1]["text"], "Guest acts")
        self.assertNotIn("turnCheckpoint", restored["snapshot"])

    def test_stale_gm_edit_is_rejected_without_overwriting_new_state(self) -> None:
        previous = self.runtime.state(self.host)
        self.runtime.update_sheet({**self.guest, "sheet": {"attributes": {"Finesse": 9}}})
        with self.assertRaisesRegex(ValueError, "party changed"):
            self.runtime.gm_update({**self.host, "expectedRevision": previous["revision"], "snapshot": previous["snapshot"]})
        self.assertEqual(self.runtime.state(self.host)["snapshot"]["gameState"]["characters"][self.guest["playerId"]]["attributes"]["Finesse"], 9)

    def test_guest_views_redact_gm_state_in_current_and_previous_turns(self) -> None:
        game = {"journal": [{"text": "PUBLIC", "visibility": "public"}, {"text": "PRIVATE-JOURNAL", "visibility": "private"}],
            "clocks": [{"name": "PRIVATE-CLOCK", "visibility": "gm"}],
            "rolls": [{"label": "PRIVATE-ROLL", "visibility": "gm"}],
            "transactions": [{"summary": "PRIVATE-TRANSACTION", "operations": [{"text": "PRIVATE-JOURNAL"}]}],
            "npcs": {"npc": {"name": "Scout", "notes": "PRIVATE-NPC"}}}
        self.runtime.gm_update({**self.host, "snapshot": {"gameState": game}})
        self.runtime.submit({**self.host, "text": "Host acts"})
        self.runtime.submit({**self.guest, "text": "Guest acts"})
        self.runtime.commit({**self.host, "snapshot": {"gameState": game}})
        guest = self.runtime.state(self.guest)
        self.assertNotIn("PRIVATE-", str(guest))
        self.assertIn("PUBLIC", str(guest))
        self.assertIn("PRIVATE-JOURNAL", str(self.runtime.state(self.host)))

    def test_rehost_preserves_saved_sheet_and_remaps_original_reset_baseline(self) -> None:
        created = self.runtime.create_room({"displayName": "Reopened", "resumeCharacterId": "old-host",
            "sheet": {"name": "Host", "resources": {"hp": {"value": 4, "max": 12}}},
            "snapshot": {"turn": 3, "gameState": {"characters": {"old-host": {"resources": {"hp": {"value": 4}}}, "old-guest": {"name": "Archived guest"}},
                    "encounters": [{"initiative": ["old-guest", "old-host"], "turn": 1}]},
                "campaignStart": {"turn": 0, "history": [{"role": "dm", "text": "Original opening"}],
                    "gameState": {"characters": {"old-host": {"resources": {"hp": {"value": 12, "max": 12}}}}}},
                "turnCheckpoint": {"turn": 2, "gameState": {"characters": {"old-host": {"resources": {"hp": {"value": 8}}}}},
                    "roomRoundNumber": 3, "submissions": [{"playerId": "old-host", "submitted": True, "text": "Acts"}]}}})
        auth = {"roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
            "playerId": created["hostPlayerId"], "playerToken": created["playerToken"]}
        state = self.runtime.state(auth); snapshot = state["snapshot"]
        self.assertNotIn("old-host", str(snapshot))
        self.assertEqual(snapshot["gameState"]["characters"][auth["playerId"]]["resources"]["hp"]["value"], 4)
        self.assertEqual(snapshot["gameState"]["encounters"][0]["initiative"], [auth["playerId"]])
        self.assertEqual(snapshot["gameState"]["encounters"][0]["turn"], 0)
        self.assertIn("old-guest", snapshot["gameState"]["characters"])
        self.assertEqual(snapshot["turnCheckpoint"]["submissions"][0]["playerId"], auth["playerId"])
        self.runtime.propose({**auth, "type": "reset"}); self.runtime.resolve_proposal(auth)
        reset = self.runtime.state(auth)
        self.assertEqual(reset["snapshot"]["gameState"]["characters"][auth["playerId"]]["resources"]["hp"]["value"], 12)
        self.assertEqual(reset["snapshot"]["history"][0]["text"], "Original opening")
        self.assertEqual(reset["round"]["number"], 1)

    def test_legacy_campaign_without_a_reset_baseline_fails_visibly(self) -> None:
        created = self.runtime.create_room({"snapshot": {"turn": 8, "gameState": {"transactions": [{"id": "played"}]}}})
        auth = {"roomCode": created["roomCode"], "inviteToken": created["inviteToken"],
            "playerId": created["hostPlayerId"], "playerToken": created["playerToken"]}
        self.runtime.propose({**auth, "type": "reset"})
        with self.assertRaisesRegex(ValueError, "no saved checkpoint"):
            self.runtime.resolve_proposal(auth, {"campaignStart": {"gameState": {}}})
        self.assertEqual(self.runtime.state(auth)["snapshot"]["turn"], 8)


if __name__ == "__main__":
    unittest.main(verbosity=2)
