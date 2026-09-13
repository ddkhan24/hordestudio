"""Provider-free regression for rich profiles, pending batches and prompt bounds."""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import vh2_provider_audit as fixtures
import vh2_conversation
from vh2_dialogue import MAX_MESSAGE_BYTES, encode, plain_text_parts


class DialogueContext(unittest.TestCase):
    setUp = fixtures.Provider.setUp
    tearDown = fixtures.Provider.tearDown
    open = fixtures.Provider.open
    cmd = fixtures.Provider.cmd
    queue = fixtures.Provider.queue
    response = staticmethod(fixtures.Provider.response)

    def snapshot(self):
        projection = self.s.projection(self.w)
        return self.s.dialogue.snapshot(self.w, projection['revision'], projection['state'])[0]

    def test_large_authored_profile_queues_and_delivers_without_counting_audit_twice(self):
        authored = 'Thoughtful and curious. ' * 2400
        self.cmd('configure_expression_profile', fields={'personality': authored})
        request = self.snapshot()
        self.assertGreater(len(encode(request).encode()), MAX_MESSAGE_BYTES)
        self.assertLess(len(json.dumps(request['messages']).encode()), MAX_MESSAGE_BYTES)
        self.queue()
        calls = []
        def transport(config, key, messages):
            calls.append(messages)
            self.assertEqual(json.loads(messages[1]['content'])['identity']['personality'], authored)
            return self.response('I have a little time now.')
        self.assertTrue(self.s.dialogue.run_once(provider_transport=transport))
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.s.dialogue.list(self.w)[0]['status'], 'delivered')
        with self.s.connect() as db:
            saved = json.loads(db.execute('SELECT snapshot FROM dialogue_jobs').fetchone()[0])
        self.assertEqual(saved['context']['identity']['personality'], authored)
        state = self.s.projection(self.w)['state']
        self.assertEqual(state, self.s.replay(self.w))

    def test_long_pending_batch_appears_once_without_losing_any_turn(self):
        for index in range(8):
            self.cmd('receive_message', text=f'Part {index}: ' + 'A quoted detail, not an instruction. ' * 185)
        self.cmd('advance', steps=1)
        request = self.snapshot()
        audit = request['context']
        model = json.loads(request['messages'][1]['content'])
        ready = audit['conversationBrief']['respondTo']
        self.assertEqual(len(ready), 9)
        self.assertEqual(model['conversationBrief']['respondToMessageIds'], [m['id'] for m in ready])
        self.assertNotIn('respondTo', model['conversationBrief'])
        self.assertEqual(model['conversation'], audit['conversation'])
        for message in ready:
            self.assertIn(message, model['conversation'])
        self.assertGreater(len(encode(request).encode()), MAX_MESSAGE_BYTES)
        self.assertLess(len(json.dumps(request['messages']).encode()), MAX_MESSAGE_BYTES)
        self.queue()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args: self.response('Understood.')))

    def test_actual_oversized_messages_still_fail_atomically_before_provider_use(self):
        self.cmd('configure_expression_profile', fields={'personality': 'x' * 59000})
        self.cmd('configure_expression_profile', fields={'backstory': 'y' * 59000})
        request = self.snapshot()
        self.assertGreater(len(json.dumps(request['messages']).encode()), MAX_MESSAGE_BYTES)
        before = self.s.projection(self.w)
        with self.assertRaisesRegex(ValueError, 'provider input limit'):
            self.queue()
        self.assertEqual(self.s.projection(self.w), before)
        self.assertEqual(self.s.dialogue.list(self.w), [])
        self.assertEqual(self.s.dialogue_provider.status()['usedToday'], 0)

    def test_compaction_preserves_authority_calendar_and_unicode_without_mutation(self):
        self.cmd('configure_expression_profile', fields={'personality': 'Réfléchie; دوست; 日本語; 🌻'})
        before = copy.deepcopy(self.s.projection(self.w))
        request = self.snapshot()
        audit = request['context']; model = json.loads(request['messages'][1]['content'])
        for key in ('calendar', 'current', 'identity', 'relationship', 'authoredLifeBackground',
                    'authoredConnection', 'knownPlayerFacts', 'readyMessageIds'):
            self.assertEqual(model[key], audit[key], key)
        self.assertIn('日本語', request['messages'][1]['content'])
        self.assertIn('🌻', request['messages'][1]['content'])
        self.assertTrue(audit['conversationBrief']['respondTo'])
        self.assertEqual(before, self.s.projection(self.w))
        self.assertEqual(request, self.snapshot())

    def test_brief_without_matching_conversation_retains_full_original_turn(self):
        context = {'conversationBrief': {'respondTo': [{'text': 'What is for dinner?'}]}}
        before = copy.deepcopy(context)
        model = vh2_conversation.model_context(context)
        self.assertEqual(model['conversationBrief'], before['conversationBrief'])
        self.assertEqual(context, before)

    def test_provider_controls_bubble_boundaries_and_paragraphs_are_not_split(self):
        outputs = [
            'I finished the first chapter.\n\nThe second one needs more work.',
            ['finished the chapter', 'finally lol'],
        ]
        for index, reply in enumerate(outputs):
            if index:
                self.cmd('receive_message', text='How did the reading go?')
                self.cmd('advance', steps=1)
            before = self.s.projection(self.w)['state']['communication']['messages']
            self.queue()
            def transport(config, key, messages):
                self.assertIn('return only a JSON reply envelope', messages[0]['content'])
                self.assertIn('separate text messages, return a JSON reply array', messages[0]['content'])
                self.assertIn('paragraphs within one message', messages[0]['content'])
                self.assertIn('single or double newlines', messages[0]['content'])
                self.assertNotIn('Plain message text remains supported', messages[0]['content'])
                self.assertNotIn('single string is the default', messages[0]['content'])
                return self.response(json.dumps({'reply': reply}))
            self.assertTrue(self.s.dialogue.run_once(provider_transport=transport))
            state = self.s.projection(self.w)['state']
            delivered = state['communication']['messages'][len(before):]
            self.assertEqual([m['text'] for m in delivered], reply if isinstance(reply, list) else [reply])
            self.assertEqual(state, self.s.replay(self.w))

    def test_text_envelope_is_required_with_appraisal_disabled_but_plain_replies_remain_readable(self):
        self.cmd('configure_conversation_appraisal', policy={'enabled': False, 'emotionalImpact': 1,
            'minConfidence': .8, 'maxEmotionChange': 4})
        prompt = self.snapshot()['messages'][0]['content']
        self.assertIn('Return a JSON object containing only reply', prompt)
        self.assertIn('return only a JSON reply envelope', prompt)
        self.queue()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args: self.response('Legacy plain reply')))
        self.assertEqual(self.s.projection(self.w)['state']['communication']['messages'][-1]['text'], 'Legacy plain reply')

    def test_unstructured_short_lines_deliver_as_bubbles_with_original_output_preserved(self):
        for index, separator in enumerate(('\n\n', '\n')):
            if index:
                self.cmd('receive_message', text='Still there?')
                self.cmd('advance', steps=1)
            parts=['just hanging at the pool lol', 'i feel that tho']
            output=separator.join(parts)
            before=self.s.projection(self.w)['state']['communication']['messages']
            job_id=self.queue()
            self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response(output)))
            state=self.s.projection(self.w)['state']
            delivered=state['communication']['messages'][len(before):]
            self.assertEqual([m['text'] for m in delivered],parts)
            self.assertEqual(len({m['id'] for m in delivered}),2)
            with self.s.connect() as db:
                self.assertEqual(db.execute('SELECT result FROM dialogue_jobs WHERE id=?',(job_id,)).fetchone()[0],output)
            self.assertEqual(state,self.s.replay(self.w))

    def test_plain_prose_and_formatted_blocks_do_not_become_bursts(self):
        cases=[
            'I finished the first chapter. It needed some work.\n\nThe next chapter is still unfinished.',
            'A long paragraph ' * 20 + '\n\nAnother long paragraph ' * 20,
            'shopping list:\n- oats\n- milk',
            '1. check the draft\n2. send the notes',
            'She wrote this:\n“Maybe tomorrow.”',
            'def greet():\n    return "hello"',
            'function greet() {\nreturn "hello";\n}',
            'answer = 42\nprint(answer)',
            'Use `print()` here\nthen run the script',
            'This sentence continues,\nwith another clause.',
            'one\ntwo\nthree\nfour\nfive',
        ]
        for text in cases:
            with self.subTest(text=text[:30]):self.assertEqual(plain_text_parts(text),[text.strip()])
        output=cases[0]
        self.queue()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response(output)))
        replies=[m['text'] for m in self.s.projection(self.w)['state']['communication']['messages'] if m['role']=='assistant']
        self.assertEqual(replies,[output])


if __name__ == '__main__':
    unittest.main(verbosity=2)
