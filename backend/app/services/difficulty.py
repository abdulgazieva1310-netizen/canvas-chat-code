"""Bounded difficulty changes derived from saved, applicable answer scores."""

LEVELS = ("Junior", "Middle", "Senior")


def transition(level, evaluation):
    """Return the effective level, average available categories, and persisted reason."""
    if evaluation is None:
        return level, None, f"No reliable evaluation; kept {level}."
    values = [getattr(evaluation, name) for name in ("accuracy", "completeness", "clarity", "structure")
              if getattr(evaluation, name) is not None]
    if not values:
        return level, None, f"No applicable category scores; kept {level}."
    raw_average = sum(values) / len(values)
    average = round(raw_average, 1)
    index = LEVELS.index(level)
    target = index + (1 if raw_average >= 8 else -1 if raw_average <= 4 else 0)
    target = max(0, min(len(LEVELS) - 1, target))
    effective = LEVELS[target]
    if effective == level:
        reason = f"Average {average} did not change the level from {level}."
        if raw_average >= 8 or raw_average <= 4:
            reason = f"Average {average} reached a level boundary; kept {level}."
    elif target > index:
        reason = f"Average {average} was at least 8; increased from {level} to {effective}."
    else:
        reason = f"Average {average} was at most 4; decreased from {level} to {effective}."
    return effective, average, reason
