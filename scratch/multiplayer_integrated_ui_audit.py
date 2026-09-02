from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class MultiplayerIsolationUiAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.app = (ROOT / "app.js").read_text(encoding="utf-8")
        cls.multiplayer = (ROOT / "multiplayer.js").read_text(encoding="utf-8")
        cls.engine = (ROOT / "multiplayer-engine.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "style.css").read_text(encoding="utf-8")

    def test_multiplayer_owns_a_dedicated_gameplay_surface(self) -> None:
        self.assertIn('id="multiplayer-session-view"', self.html)
        self.assertIn('id="mp-session-transcript"', self.html)
        self.assertIn('id="mp-session-roster"', self.html)
        self.assertNotIn('id="chat-party-dock"', self.html)
        self.assertNotIn('id="world-party-dock"', self.html)

    def test_single_player_controls_do_not_route_into_multiplayer(self) -> None:
        self.assertNotIn("HordeMultiplayer.isActive", self.app)
        self.assertNotIn("HordeMultiplayer.submit", self.app)
        self.assertNotIn('id="chat-multiplayer-btn"', self.html)
        self.assertNotIn('id="world-multiplayer-btn"', self.html)

    def test_campaigns_are_independent_and_reopenable(self) -> None:
        self.assertIn("CAMPAIGN_KEY", self.multiplayer)
        self.assertIn("prepareCampaign", self.multiplayer)
        self.assertIn("executeIsolatedMultiplayerTurn", self.app)
        self.assertNotIn("activateMultiplayerContext", self.app)

    def test_rules_are_system_agnostic(self) -> None:
        for preset in ("custom", "d20", "cyberpunk-d10", "dice-pool", "narrative"):
            self.assertIn(preset, self.engine)
        self.assertIn('id="world-party-custom-rules"', self.html)
        self.assertIn("Every participant has a separate identity", self.html)

    def test_rpg_state_is_visible_and_not_only_prompt_text(self) -> None:
        for label in ("Resources & progression", "Defenses", "Currencies", "PARTY INVENTORY"):
            self.assertIn(label, self.multiplayer)
        for operation in ("effect-add", "advancement-spend", "shared-inventory-add", "encounter-start"):
            self.assertIn(operation, self.engine)
        for control in ("data-gm-currency", "data-gm-shared-item", "data-gm-clock", "data-gm-quest", "data-gm-scene"):
            self.assertIn(control, self.multiplayer)

    def test_model_output_cannot_leak_state_payload_into_chat(self) -> None:
        self.assertIn("parseMultiplayerReceipt", self.app)
        self.assertIn("must never contain JSON or tool syntax", self.app)

    def test_commit_is_isolated_from_background_polling(self) -> None:
        self.assertIn("committing: false", self.multiplayer)
        self.assertIn("party.busy || party.committing", self.multiplayer)
        self.assertIn("Engine.migrateCampaign(Engine.clone(campaignForRender(current)))", self.multiplayer)
        self.assertIn("party.campaign = campaign", self.multiplayer)


if __name__ == "__main__":
    unittest.main()
