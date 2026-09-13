"""Typed compatibility fields shared by Person save and persistent life."""
BOOL={'socialFeedEnabled','socialFeedImages','allowPhotos','allowVoiceNotes','allowVideoClips','videoAudio','lifeWeatherEnabled','libidoEnabled'}
NUMBER={'socialPhotoRatio':(0,100),'socialThirstTrapLevel':(0,100),'socialSubscriptionPrice':(0,1000000),'age':(18,120),'knownBeforeDays':(0,36500),'timezoneOffsetMinutes':(-840,840),'locationLatitude':(-90,90),'locationLongitude':(-180,180),'videoDuration':(2,30)}
TEXT={'privateLife','routine','playerKnowledge','initialMotive','connectionAuthenticity','startingScenario','socialWorld','connectionType','connectionRole','relationshipContext','priorContact','regulationProfile','conflictRecovery','emotionExpression','ruminationStyle','reactionTiming','emotionalGranularity','socialPostFrequency','socialPlatform','socialAudience','socialPlayerRole','socialWritingStyle','socialPostingRules','socialMonetization','socialCurrency','socialAdultLevel','socialAccessRules','videoStyleRules','videoProvider','videoModel','videoResolution','videoReferencePolicy','sleepArchetype','locationMode','location','locationLabel','timezone','pronouns','occupation','initiativeMode','libidoBaseline','sexualConfidence','sexualRiskAppetite'}
LIST={'socialContentTypes'}
FIELDS=BOOL|set(NUMBER)|TEXT|LIST

AUTHORED_TEXT_LIMITS={'privateLife':2000,'routine':2000,'playerKnowledge':1800,'initialMotive':1600,'startingScenario':3000,'connectionAuthenticity':32}

ENUMS={'connectionAuthenticity':{'genuine','mixed','performative','instrumental','deceptive'},'regulationProfile':{'steady','typical','sensitive','volatile'},'conflictRecovery':{'quick','normal','slow','grudge'},'emotionExpression':{'transparent','guarded','masked','performative'},'ruminationStyle':{'low','normal','high','sticky'},'reactionTiming':{'immediate','mixed','delayed'}}

def validate(key,value):
 if key in ENUMS and (not isinstance(value,str) or value not in ENUMS[key]):raise ValueError('Unsupported '+key)
 if key in BOOL and type(value) is not bool:raise ValueError(key+' must be on or off.')
 if key in ('locationLatitude','locationLongitude') and value is None:return
 if key in NUMBER:
  low,high=NUMBER[key]
  if type(value) not in (int,float) or not low<=value<=high:raise ValueError('Invalid '+key)
 if key in TEXT and (not isinstance(value,str) or len(value)>AUTHORED_TEXT_LIMITS.get(key,4000)):raise ValueError('Invalid '+key)
 if key in LIST and (not isinstance(value,list) or len(value)>30 or any(not isinstance(x,str) or len(x)>80 for x in value)):raise ValueError('Invalid '+key)

def apply(c,fields):
 for key,value in fields.items():
  if key in FIELDS:validate(key,value);c[key]=value
 # Old feed enable/frequency controls govern sharing, not capture or invitations.
 if 'socialFeedEnabled' in fields or 'socialPostFrequency' in fields:
  c['vh2SocialPolicy']={'enabled':c.get('socialFeedEnabled',False),'frequency':c.get('socialPostFrequency','occasional')}
