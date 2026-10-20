# Compare saved reports

Select two ended interviews in History and open **Compare selected reports**.
`/compare?first=<interview-id>&second=<interview-id>` is a validated local route
and survives reload/login. Both reports are read through existing owner-scoped
report endpoints; no AI generation or score recalculation is requested.

Numeric deltas are second minus first and appear only for the same role, type,
mode and recorded interview language. Missing categories stay unscored and are
never converted to zero. Starting/effective levels and partial counts remain
visible, with an explicit warning when starting levels differ. The view keeps
saved evidence separate and warns that questions may differ and coaching scores
are approximate. Incompatible reports can be read but receive no numeric change
claims. The layout stacks report cards on small screens and retains text/table
score equivalents.
