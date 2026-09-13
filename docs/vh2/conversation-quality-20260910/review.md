# Blinded conversation review

Offline supplied outputs only. No provider was called. Default candidates are authored fixtures, not a measured model improvement.

For each candidate rate relevance, memory grounding, appropriate familiarity, repetition and appropriate length from 1–5. Then choose a preference or tie. These ratings require a human reviewer.

## simple-answer

Answers directly; no compulsory teasing or new question.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "Are you busy?"
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "current": {
    "activity": "studying",
    "availability": "busy"
  },
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "Are you busy?"
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Address the actual question before adding another topic."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> yeah, studying

Ratings: __ / __ / __ / __ / __

### Candidate B

> Look at you checking up on me. Yes, I'm working, but don't let it go to your head that I made time for you.

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## first-occurrence

Does not turn a first occurrence into a recurring shared habit.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "I finally tried that cafe you mentioned. First time I've been."
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "I finally tried that cafe you mentioned. First time I've been."
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Possible correction: check the wording and prior evidence; acknowledge a real mistake without defending it."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> what did you get?

Ratings: __ / __ / __ / __ / __

### Candidate B

> I love when you go to our little spot. You always make my day.

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## remember-london

Uses the known claim without assuming which home the player means.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "I'm heading home this weekend."
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "knownPlayerFacts": [
    {
      "id": "claim1",
      "text": "I grew up in London and my parents still live there.",
      "truthScope": "player_claim"
    }
  ],
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "I'm heading home this weekend."
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [
        {
          "id": "claim1",
          "text": "I grew up in London and my parents still live there.",
          "truthScope": "player_claim"
        }
      ],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> Where are you from again?

Ratings: __ / __ / __ / __ / __

### Candidate B

> back to London?

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## correction

Accepts a correction without defensive banter.

```json
{
  "conversation": [
    {
      "id": "a",
      "role": "assistant",
      "text": "Good luck tomorrow!"
    },
    {
      "id": "u",
      "role": "user",
      "text": "It's today, I said today."
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "It's today, I said today."
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Possible correction: check the wording and prior evidence; acknowledge a real mistake without defending it."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 1,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> sorry, today. good luck!

Ratings: __ / __ / __ / __ / __

### Candidate B

> Don't get ahead of yourself, I'm just observing the data.

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## closing

Lets the exchange close.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "Gotta go. Talk later."
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "Gotta go. Talk later."
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Possible closing: allow the exchange to end without a question or a new topic."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> later!

Ratings: __ / __ / __ / __ / __

### Candidate B

> Okay, but before you go, what's the best thing that happened today?

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## substantive

Does not confuse natural brevity with dismissiveness; engages with the actual dilemma.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "I can't decide whether to move closer to my parents. I miss them, but I'd lose my friends here. Can we talk it through?"
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "identity": {
    "chatLength": "adaptive"
  },
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "I can't decide whether to move closer to my parents. I miss them, but I'd lose my friends here. Can we talk it through?"
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Address the actual question before adding another topic."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> yeah. would moving mean losing touch with your friends, or mostly seeing them less? those feel pretty different.

Ratings: __ / __ / __ / __ / __

### Candidate B

> yeah

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## repeated-deflection

Can accept warmth without another defensive tease.

```json
{
  "conversation": [
    {
      "id": "a1",
      "role": "assistant",
      "text": "Don't let it go to your head. You wish?"
    },
    {
      "id": "a2",
      "role": "assistant",
      "text": "Don't let it go to your head. You wish?"
    },
    {
      "id": "a3",
      "role": "assistant",
      "text": "Don't let it go to your head. You wish?"
    },
    {
      "id": "u",
      "role": "user",
      "text": "Thanks, that helped."
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "Thanks, that helped."
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [
        {
          "phrase": "don't let it go to your head",
          "messages": 3
        },
        {
          "phrase": "it go to your head you wish",
          "messages": 3
        },
        {
          "phrase": "let it go to your head you",
          "messages": 3
        }
      ],
      "patternCounts": {
        "question_ending": 3,
        "deflecting_tease": 3
      },
      "sampleSize": 3,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> glad it helped

Ratings: __ / __ / __ / __ / __

### Candidate B

> Don't let it go to your head. You wish?

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __

## unknown-location

Does not confirm an unestablished location; flag missing state during evaluation.

```json
{
  "conversation": [
    {
      "id": "u",
      "role": "user",
      "text": "Still at the gym?"
    }
  ],
  "readyMessageIds": [
    "u"
  ],
  "current": {
    "location": {
      "status": "unknown"
    }
  },
  "conversationBrief": {
    "version": 1,
    "respondTo": [
      {
        "id": "u",
        "role": "user",
        "text": "Still at the gym?"
      }
    ],
    "lengthPreference": "adaptive",
    "lengthGuidance": "Use the shortest response that completes the conversational intention; a word or fragment is valid. Expand for substance, not personality performance.",
    "minimalAcknowledgementCandidate": false,
    "cueHints": [
      "Address the actual question before adding another topic."
    ],
    "intentOptions": [
      "answer",
      "acknowledge",
      "clarify",
      "share_relevant_experience",
      "express_a_need",
      "disagree_or_decline",
      "close"
    ],
    "selectionRule": "Choose what this exchange needs before wording it. These are options, not a sequence or a required output schema. Ambiguous cues are not facts.",
    "recentExpression": {
      "repeatedPhrases": [],
      "patternCounts": {},
      "sampleSize": 0,
      "interpretation": "Surface repetition signals only. Vary optional filler; ordinary confirmations, names, facts and intentional quotations may repeat."
    },
    "memoryEvidence": {
      "playerClaims": [],
      "recalledRecords": []
    },
    "evidenceRule": "Only establish a recurring shared habit from repeated recorded events. A single occurrence is a single occurrence. A player claim remains a claim. Missing evidence is uncertainty, not a reason to ask again for a fact already supplied."
  }
}
```

### Candidate A

> I'll catch you up in a bit.

Ratings: __ / __ / __ / __ / __

### Candidate B

> Yep, still at the gym!

Ratings: __ / __ / __ / __ / __

Preference: __   Notes: __
