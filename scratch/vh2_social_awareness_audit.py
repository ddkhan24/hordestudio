"""Social awareness survives compaction and remains separate from hidden activity."""
import sys,json,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_library_audit import Library
import vh2_social,vh2_conversation
class Awareness(Library):
 def test_old_post_reaction_survives_until_noticed(self):
  self.seed();self.cmd('comment_post',postId='post0',text='Remember this?')
  state=self.s.projection(self.w)['state']
  self.assertTrue(any(p['id']=='post0' for p in state['social']['posts']))
  state['truth']['present']['availability']='asleep';vh2_social.observe(state)
  self.assertEqual(vh2_social.notifications(state),[])
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['truth']['present']['availability']='available';after['simAt']+=1000;vh2_social.observe(after)
   self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_NOTICE')
  state=self.s.projection(self.w)['state'];notice=vh2_social.notifications(state)[0]
  self.assertEqual(notice['postId'],'post0');self.assertEqual(notice['text'],'Remember this?')
  self.assertIn('post0',[p['id'] for p in vh2_social.context(state)])
  self.assertEqual(state,self.s.replay(self.w));self.s.close();self.s=self.open()
  self.assertEqual(vh2_social.notifications(self.s.projection(self.w)['state']),[notice])
 def test_noticed_comment_enters_retrievable_memory(self):
  self.seed();self.cmd('comment_post',postId='post0',text='That turquoise scarf was lovely')
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['truth']['present']['availability']='available';vh2_social.observe(after);self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_NOTICE')
  with self.s.connect() as db:
   row=db.execute("SELECT data FROM memory_episodes WHERE world_id=? AND summary LIKE '%turquoise%'",(self.w,)).fetchone()
  self.assertIsNotNone(row);self.assertEqual(json.loads(row['data'])['evidenceScope'],'observed_social_record')
  projection=self.s.projection(self.w);state=projection['state'];state['communication']['messages'].append({'id':'read-query','role':'user','text':'Remember the turquoise scarf comment?','readAt':state['simAt'],'awaitingReply':True})
  self.assertTrue(any('turquoise' in p['summary'] for p in self.s.recall(self.w,projection['revision'],state)))
 def test_reactions_not_removed_by_unrelated_chat_retrieval(self):
  self.seed();self.cmd('like_post',postId='post0',liked=True)
  state=self.s.projection(self.w)['state'];state['truth']['present']['availability']='available';state['simAt']+=1000;vh2_social.observe(state)
  context={'conversationBrief':{'respondTo':[{'text':'What is for dinner?'}]},'ownSocialPosts':vh2_social.context(state),'noticedSocialActivity':vh2_social.notifications(state)}
  brief=vh2_conversation.model_context(context)
  self.assertEqual(brief['noticedSocialActivity'][0]['kind'],'like')
 def test_duplicate_like_does_not_make_new_notification(self):
  self.seed();self.cmd('like_post',postId='post0',liked=True)
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before));after['truth']['present']['availability']='available';vh2_social.observe(after);self.s.commit_event(db,self.w,rev,before,after,'FIXTURE_NOTICE')
  noticed=vh2_social.notifications(self.s.projection(self.w)['state'])
  self.cmd('like_post',postId='post0',liked=True)
  self.assertEqual(vh2_social.notifications(self.s.projection(self.w)['state']),noticed)
if __name__=='__main__':unittest.main(verbosity=2)
