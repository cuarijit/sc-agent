# Administration

## Purpose
Administration covers everything an admin does to operate the tenant: provisioning users + roles, enabling / disabling modules and pages, branding the application, and authoring help / user-guide content.

## When to use it
- Onboarding a new user → Users & Roles.
- Renaming a module label or hiding a page from a role → Modules & Pages.
- Uploading a customer logo for the header → Branding & Logos.
- Writing or updating a user guide for a page → Documentation.

## Pages in this module
| Page | What it answers |
|---|---|
| Users & Roles | Who can log in, what role + DAGs do they have? |
| Modules & Pages | Which modules / pages are visible, which roles can see what? |
| Branding & Logos | What logos and product names display in the header / login? |
| Documentation | What help content is shown to users, and how do I edit it? |

## Permissions
Every page in this module requires the **admin** role. Non-admins see a "Forbidden" view if they navigate directly.

## Common pitfalls
- Renaming a module label sticks across restarts (the seed will not overwrite admin edits).
- Deleting a system module (e.g. `administration`) is blocked — the API rejects deletions on protected slugs.
