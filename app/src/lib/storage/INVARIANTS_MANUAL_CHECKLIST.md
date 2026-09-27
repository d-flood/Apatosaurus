# Data-Safety Invariant Manual Checklist

## Invariant 8: Persistence Requested and Surfaced

Run this check in each supported browser because storage persistence policy cannot be controlled reliably by automation.

1. Clear the site's storage and reload Apatosaurus.
2. Create a project or another meaningful document-store write.
3. In browser developer tools, verify the site requested persistent storage or already reports persistent storage as granted.
4. If persistence is denied or unsupported, verify the Projects storage panel visibly warns that the data is browser-only.
5. Dismiss the warning, create another project milestone, and verify the warning returns.
6. If persistence is granted, verify the browser-only durability warning is absent.

Record the browser name/version, installed-PWA state, persistence result, and visible UI result when running the checklist.
