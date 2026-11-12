# Phone mockup assessment — visual acceptance FAILED

Assessed November 12, 2026. No application code changed and nothing published or deployed by this assessment.

## Evidence and scope

Beta head remains `80a82ac5492bba782710f361fbb3c45d7947611f`; application release PR101. No newer beta head or competing phone-layout PR was found. PR97 and the sequential queue remain paused.

Compared the five approved generated references against the final PR101 WebKit screenshots from run [43150250682](https://github.com/Velnu38/Velnu/actions/runs/43150250682), artifact 13913053753. These are synthetic browser captures of the tested application, not fresh screenshots from the owner's phone. Reference phone frame/status area is cropped and content width normalized to 390px. Reference proportions are approximate design guidance, not precise CSS measurements. Different job data is not counted as a visual defect. Full-page browser captures include fixed navigation at the captured viewport position; this artifact is not evidence of a navigation overlap bug.

## Confirmed differences

| Area | Approved reference | Current implementation | Assessment |
|---|---|---|---|
| Summary hierarchy | Prominent title, compact header/account/picker stack | 72px topbar; smaller heading/control labels; selected card starts around 355px versus roughly 270px in normalized reference | Excess vertical space above useful work; small text does not make the interface compact |
| Buttons and tabs | Consistent visual weight within each control type | Heading actions use 40px/12px text; area buttons 44px/12–14px; footer and inline actions retain different inherited treatments | Equivalent actions need shared dimensions, padding and typography |
| Card shapes | Consistent outlined cards and rounded controls | Independent 9/10/12/13/14/16px radius rules plus inherited panel styles | Consolidation did not establish one reusable visual system |
| Work | Bold four-card grid, job status, next-visit context | Grid is closer, but smaller labels, different vertical rhythm, status absent from compact identity and repeated navigation below | Not a sufficiently close match |
| Billing/Records | Large bold row labels, icon divider, aligned rows | Smaller row labels, no icon divider, extra Job actions/overview/Jobs tabs | Different density and composition; retain unique existing actions through an intentional secondary placement |
| Tasks | Full-width Add task/Templates row, large outlined task cards, strong title and metadata | Small inline actions alongside heading; thin list rows; task title inherits 12px label styling | Largest mismatch; needs an actual task-card presentation using the existing controls |
| Screen sizing | Readable content fills available phone width | Emulated width checks pass, but the owner's reported small-screen/partial-width condition remains unverified | Must remain open; no claim that the physical problem is fixed |

## Specific source defect

`JobManagementEditors.tsx` renders task titles inside `label > span`. `job-phone.css` sets the larger task title size on `.jm-task-list strong`, which matches no title element. The actual title inherits the global 12px `label` style. A general panel wrapper did not restyle the task controls.

## Why the earlier verification was insufficient

- Width assertions compared shell elements against the configured layout viewport. They did not establish the owner's actual Safari/in-app-browser visual viewport or zoom condition.
- Navigation tests opened all nine panels, but detailed screenshots covered the main menus, Tasks and the Add task editor only. Other destinations and editors were not compared visually to the same design rules.
- There was no measured mockup comparison or acceptance threshold. A green functional suite was incorrectly treated as sufficient evidence of design fidelity.
- Empty synthetic data omitted the next visit, phone/address shortcuts and activity content shown in the references. A realistic populated fixture is needed alongside empty/long-content states.

## Required acceptance before another beta deployment

1. Establish one reference-derived set of type sizes/weights, spacing, radii, icon treatment and control dimensions. Equivalent control types must agree across all pages; keep accessible touch targets.
2. Render the same populated job through Summary, Work, Billing, Records, all nine existing detail panels and every editor reachable from them. Preserve roles, deep links, Back/Cancel, removal and all other existing actions.
3. Compare reference and rendered app at the same usable content width, excluding phone hardware and browser chrome. Provide side-by-side screenshots for all five approved references, and annotated comparisons for the remaining derived screens. Review differences individually rather than asserting an invented percentage similarity.
4. Verify 320, 375, 390, 393 and 430px portrait, landscape, safe areas, large text, keyboard-open editors, direct links and navigation after visiting other modules. Measure document/layout/visual viewport widths and scale; ensure no unintended horizontal overflow, constrained ancestor or zoomed-out rendering.
5. Obtain evidence for the owner's actual display condition before calling that issue fixed. Emulated browsers alone cannot certify the reported physical/in-app Safari behavior.
6. Only after visual acceptance, run focused interaction checks and the required release gate. Keep beta unchanged while comparisons fail. Do not add fake data, new workflows or provider behavior to reproduce decorative mockup content.

## Follow-up

The initial PR101 failure findings above are retained. The authorized implementation and new comparisons are documented in [phone reference comparison](PHONE_REFERENCE_MATCH_2026-11-12.md). Original PR101 captures remain identified by the run and artifact receipt above. Physical-device and owner acceptance remain separate.
