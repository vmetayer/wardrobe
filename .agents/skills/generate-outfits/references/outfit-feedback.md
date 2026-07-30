# Outfit Feedback

Read `data/outfit-feedback.json` when present. It has this shape:

```json
{
  "version": 1,
  "ratings": {
    "outfit-id": {
      "rating": "up",
      "updatedAt": "ISO-8601 timestamp",
      "outfit": {
        "id": "outfit-id",
        "name": "Outfit name",
        "occasion": ["smart-casual"],
        "styleArchetype": "simple-intentional-base",
        "styleSignals": ["compact-top-fuller-trouser"],
        "garmentIds": ["top-id", "bottom-id"],
        "reason": "Why the combination works."
      }
    }
  }
}
```

`rating` is `up` or `down`. Cleared ratings are removed. The embedded outfit snapshot preserves learning after `data/outfits.json` is replaced.

## Interpret the evidence

- Treat a like as positive evidence for the complete combination, archetype, style signals, silhouette relationship, and color logic.
- Treat a dislike as negative evidence for the complete combination and its combined signals.
- Never infer that one garment is categorically disliked from a single whole-outfit downvote.
- Give patterns repeated across multiple ratings more weight than one-off votes.
- Let an explicit user request override historical feedback.
- Ignore malformed entries and entries without an outfit snapshot.

## Adjust candidate scores

Start with the skill's 12-point candidate score.

- Add `+1` when a candidate clearly repeats a signal or archetype supported by at least two likes.
- Add at most `+2` total for feedback.
- Subtract `-1` when a candidate repeats a signal or archetype appearing in at least two dislikes.
- Subtract `-2` for the exact same garment combination as a disliked outfit; reject it unless explicitly requested.
- Do not penalize an unrated garment or genuinely new signal.

Across collections of five or more, reserve roughly 20% for coherent exploration outside the strongest liked cluster. Every exploratory look must still satisfy the saved style profile and base quality threshold.

Do not overwrite or clear `data/outfit-feedback.json` while generating a new collection.
