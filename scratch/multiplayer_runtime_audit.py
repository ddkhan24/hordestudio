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
            "persona": {"name": "Mara", "pronouns": "she/her", "publicIdentity": "Town medic",
                        "secret": "must-not-leak"},
            "snapshot": {"worldName": "Audit World", "sessionName": "Timeline",
                         "location": "Square", "turn": 3,
                         "hud": {"location": {"name": "Square", "description": "Market day"},
                                 "stats": [{"id": "hp", "name": "HP", "value": 8, "min": 0, "max": 10}],
                                 "outfit": "Travel cloak", "inventory": ["Map"],
                                 "apiKey": "nested-secret"},
                         "history": [{"role": "dm", "text": "Opening"}],
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
        proposed = self.runtime.propose({**self.guest, "type": "reroll", "label": "Reroll"})
        self.runtime.vote({**self.host, "proposalId": proposed["proposalId"], "approve": True})
        with self.assertRaises(PermissionError):
            self.runtime.resolve_proposal(self.guest)
        self.runtime.resolve_proposal(self.host)

    def test_snapshot_is_allow_listed(self) -> None:
        state = self.runtime.state(self.guest)
        self.assertNotIn("apiKey", state["snapshot"])
        self.assertEqual(set(state["snapshot"]),
                         {"experienceType", "experienceName", "worldName", "sessionName", "location", "turn", "hud", "history", "campaignMeta", "gameState"})
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
