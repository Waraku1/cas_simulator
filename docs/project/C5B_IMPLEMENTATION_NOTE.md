# C5B Implementation Note

This branch is intentionally bounded to performance instrumentation and evidence governance.

It does not change:

- flight dynamics or control sensitivity;
- bank-mediated heading behavior;
- theater geometry;
- multiplayer pose protocol;
- matchmaking or aircraft assignment;
- Heart Point competition rules;
- authentication/session semantics;
- rating transactions.

The only runtime addition is a headless reuse of the existing C2 diagnostics collector while the production match flight surface is mounted. Development mode continues to use the visible diagnostics panel, so only one diagnostics collector is active in either mode.

The new global evidence object is observational only. It is not consumed by gameplay, network authority, matchmaking, account, or result code.
