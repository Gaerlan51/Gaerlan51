import unittest

from ops.render import UnfilledPlaceholderError, render


class RenderTests(unittest.TestCase):
    def test_renders_when_every_placeholder_has_a_value(self):
        self.assertEqual(render("Hi ${name}", {"name": "Test Student A"}), "Hi Test Student A")

    def test_missing_key_raises_rather_than_emitting_the_placeholder(self):
        with self.assertRaises(UnfilledPlaceholderError) as ctx:
            render("Amount due: ${amount_due}", {})
        self.assertIn("amount_due", str(ctx.exception))

    def test_blank_value_raises(self):
        with self.assertRaises(UnfilledPlaceholderError):
            render("Amount due: ${amount_due}", {"amount_due": "   "})

    def test_none_value_raises(self):
        with self.assertRaises(UnfilledPlaceholderError):
            render("Amount due: ${amount_due}", {"amount_due": None})

    def test_placeholder_smuggled_in_through_a_value_is_caught(self):
        with self.assertRaises(UnfilledPlaceholderError) as ctx:
            render("Note: ${note}", {"note": "still owes ${amount_due}"})
        self.assertIn("survived", str(ctx.exception))

    def test_extra_values_are_harmless(self):
        self.assertEqual(render("Hi ${a}", {"a": "x", "b": "y"}), "Hi x")
