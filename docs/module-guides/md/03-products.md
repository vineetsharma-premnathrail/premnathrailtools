# Product Management Module

Product Management is the company's **finished-product master**. It is the one list of the finished products Premnathrail makes and sells (for example RRB Sanding Vehicle or Scissor Lift). For each product it holds the type, the model number, the lifecycle status, the sales and service defaults (unit, HSN code, standard warranty), a link to the finished-good Store item, the **applications** the product is used for (for example OHE inspection or Track sanding), and a list of technical specifications. In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance) it is reference data that the whole chain can use. Sales/BD use it to find the right product for an enquiry by application. Design/BOM, Production and Sales order lines use the linked Store item as the stock/BOM code. Service uses the default warranty as the starting point for a machine's warranty. The module has no approvals, no workflow documents and no notifications. It is a master-data module only.

## 1. Navigation Tabs

The sub-nav (ProductsNav) sits at the top of every page in the module. A tab only shows if the user has **view** permission on it. The right side of the nav bar also has the guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Products | /dashboard/products | The product master list. This tab stays highlighted on every product page: the list, New Product, a product's view page and its edit page. |
| Applications | /dashboard/products/applications | The applications master. On this screen you add, rename, retire and reactivate the applications that products are tagged with. |

You reach the module from the main sidebar entry **Product Management**, or from the home dashboard card that says "The finished products we make and sell — product master, applications and technical specifications." Both only appear if the user has the **products** app.

## 2. Dashboard

This module has **no separate dashboard page**. The landing page (/dashboard/products) is the Products list, described in section 3. It has no KPI cards, charts or widgets.

## 3. Screens

### Products list — /dashboard/products

The page header shows the small caption "PRODUCT MANAGEMENT" and the title "Products".

#### List view

| Column | What it shows |
|---|---|
| Code | The product code, in bold (for example RRB-SV). |
| Name | The product name. |
| Type | The product type label: Rail-road vehicle, Machine, Equipment or Attachment / accessory. |
| Model | The model number, or "—" if there is none. |
| Applications | The names of all tagged applications, separated by commas, or "—" if there are none. |
| Status | A coloured pill: In development (blue), Active (green), Phased out (amber) or Discontinued (grey). |
| (last column) | A "View" link. |

**Filters** (in a row above the table). Changing any filter reloads the list after a short delay (0.25 seconds):

- **Search box** ("Search code, name or model…"). A partial match, ignoring upper/lower case, on product code, name or model number.
- **Type dropdown**. "All types" or one of the four product types.
- **Status dropdown**. "All statuses" or one of the four statuses.
- **Application dropdown**. "All applications" or one **active** application. It shows only products tagged with that application.

**Sort:** the list is always sorted by product name, A to Z. You cannot change the sort order.

**Data scope:** the list only shows products inside the user's Products data scope (see section 5).

**Row actions:** click anywhere on a row, or on its "View" link, to open the product's view page. The page URL uses a signed record reference, not the raw id.

**Empty states:** "Loading…" while data loads. "No products match these filters." when filters are set and nothing matches. "No products yet — add your first finished product (e.g. RRB Sanding Vehicle)." when there are no products at all.

**Top buttons:**

- **+ New Product**. Opens /dashboard/products/new. It is shown only to users with the Products › create permission.

Errors appear in a red banner above the filters.

### New Product — /dashboard/products/new

The header title is "New Product". A "← Back" button returns to the Products list. Only users with the Products › create permission can actually save; the backend rejects anyone else.

#### Create form

The form has five sections. Fields marked * are required.

**Section "Product"**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text | Yes | Typed by the user (placeholder RRB-SV) | Up to 30 characters. Shown in capitals and saved in capitals after trimming spaces. Must be unique across all products (the check ignores upper/lower case). A duplicate gives "Product code '…' is already used by … — codes are unique; pick another code or edit that product." **The code cannot be changed after the product is created.** |
| Name | text | Yes | Typed by the user (placeholder RRB Sanding Vehicle) | Cannot be blank. Spaces at the start and end are removed. |
| Type | dropdown | Yes (always has a value) | Rail-road vehicle, Machine, Equipment, Attachment / accessory. The list comes from the backend's /products/meta. The form starts on Rail-road vehicle. | Must be one of the four types. The list is fixed in code; an admin cannot add types. |
| Model number | text | No | Placeholder PRT-SV-01 | Up to 100 characters. If left blank it is saved as empty. |
| Status | dropdown | Yes (always has a value) | In development, Active, Phased out, Discontinued. The list comes from /products/meta. The form starts on **In development**. | Must be one of the four statuses. |

Hint under the section: "Only Active products should be quoted and sold. Phased out = still serviced, not sold new. A product can be deleted only while it is In development."

**Section "Applications — where this product is used"**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Applications | multi-select chips (click to tick or untick) | No | All **active** applications from the Applications master. Retired applications appear only if this product is already tagged with them, and they are marked "(retired)". Hovering over a chip shows the application's description. | A ticked chip shows "✓" and an orange highlight. Every id you pick must still exist. If one has been removed you get "Application(s) #… no longer exist — refresh the page and pick again." |

If there are no applications, the section says: "No applications yet — add them under the Applications tab (e.g. OHE inspection, Track sanding), then tick them here."

**Section "Sales & service defaults"**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Unit | text | No (defaults to Nos) | Free text. The form starts with "Nos". | Up to 20 characters. If left blank it is saved as "Nos". This is the selling unit. |
| HSN code | text | No | Placeholder 8604. It is filled in automatically from the Store item's HSN/SAC code when you pick a Store item and the HSN field is still empty. | Up to 20 characters. This is the GST classification an invoice line needs. |
| Warranty (months) | number | No | Placeholder 12 | Must be between 0 and 240. Outside that range you get "Warranty must be between 0 and 240 months — leave it empty if there is no standard warranty." Leave it empty when there is no standard warranty. Service uses it as the starting point for a machine's warranty end date. |
| Finished-good store item | search-and-pick (typeahead) | No | Type a code or name. After 0.25 seconds it searches **active** Store items by item code, item name or model and shows up to 30 matches, A to Z by name, in the format "CODE — Name (UOM)". Click one to link it. Once linked, the item shows as "CODE — Name" with an "×" to unlink it. | The item must exist. One Store item can be linked to only **one** product. Otherwise you get "That store item is already linked to product … — one stock item can represent only one product." Product Management users can pick an item without having access to the Store app. |

Hint under the section: "The store item is the stock/BOM code Design, Production and Sales orders use for this product. Link it once the item exists in Store."

**Section "Description"**

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Short description (one line, for quotations) | text | No | Placeholder "Self-propelled road-rail vehicle for rail-head sanding" | Up to 300 characters. |
| Detailed description | multi-line text | No | Free text | No length limit. Line breaks are kept on the view page. |

**Section "Technical specifications"**

This is a repeating grid of rows. The form starts with one empty row.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Parameter | text | Yes, if the row is used | Placeholder "Parameter (e.g. Max speed on rail)" | Up to 150 characters. |
| Value | text | Yes, if the row is used | Placeholder "Value (e.g. 40)" | Up to 200 characters. Values are free text, not numbers. |
| Unit | text | No | Placeholder "Unit" | Up to 30 characters. |

- **+ Add row** adds an empty row. The red **×** removes a row. Removing the last remaining row just clears it.
- Rows where both parameter and value are empty are ignored.
- A row with only one of parameter or value filled is rejected: "Specification row N needs both a parameter and a value (e.g. Max speed on rail = 40)."
- Rows are saved in the order they appear on screen.

**Buttons at the bottom:** **Cancel** returns to the list. **Create product** saves the product and shows "Saving…" while it works. If the code or name is empty, the form stops before saving with: "Product code and name are required — e.g. code RRB-SV, name RRB Sanding Vehicle." After a successful save the user is taken to the new product's view page. The logged-in user is recorded as "Created by".

### Product view page — /dashboard/products/[ref]

[ref] is a signed record reference. If someone edits the link by hand, an "Invalid link" screen appears with a "Back to products" link. Opening a product that is outside the user's data scope returns an access-denied (403) error. A product that does not exist returns "Product #… not found — it may have been deleted; go back to the product list."

#### View page

**Header:** the title is "CODE — Name".

**Action buttons in the header:**

| Button | When it appears | What it does |
|---|---|---|
| Edit | The user has the Products › edit permission | Opens /dashboard/products/[ref]/edit. |
| Delete (red) | The status is **In development** AND the user can delete it. Delete permission follows the central rule: the Products › delete permission, checked against who created the record. | Opens a confirm dialog: "Delete product? — CODE — Name will be permanently deleted with its specifications. This can't be undone." If you confirm, the product is deleted and you return to the list. |
| ← Back | Always | Returns to the Products list. |

**Section "Product"**

The section starts with the status pill.

| Field | Meaning |
|---|---|
| Type | The product type label. |
| Model number | The model number, or "—". |
| Unit | The selling unit (for example Nos). |
| HSN code | The GST HSN code, or "—". |
| Warranty | "N months", or "—" if there is no standard warranty. |
| Store item | The linked finished-good Store item as "CODE — Name", or "Not linked". |
| Created by | The name of the user who created the product. |
| Short description | Shown in bold below the grid, if one is set. |
| Detailed description | Shown below the short description with line breaks kept, if one is set. |

**Section "Applications"**

Each tagged application is shown as a purple pill. A retired application shows as "Name (retired)". If there are none, the section says "No applications tagged yet."

**Section "Technical specifications"**

A table with the columns Parameter, Value and Unit ("—" when there is no unit), in the saved order. If there are none, the section says "No specifications recorded yet."

### Edit Product — /dashboard/products/[ref]/edit

The header title is "Edit CODE". A "← Back" button returns to the product's view page. The same signed-link and data-scope checks apply as on the view page. Saving requires the Products › edit permission.

#### Edit

- The form is the same as the Create form, filled with the current values.
- **Locked:** **Code** is greyed out and is never sent on save. A code is permanent once the product is created.
- **Editable at every status:** Name, Type, Model number, Status, Applications, Unit, HSN code, Warranty, Store item (link, change or unlink with ×), Short description, Detailed description and Specifications. No field locks because of the status.
- On save (**Save changes**):
  - The whole list of applications is replaced by the ticked set.
  - The whole list of specifications is replaced by the rows on screen. Old rows are deleted and new rows are written in screen order.
  - Blank text fields are saved as empty, and a blank Unit becomes "Nos".
  - The same checks run as on create: valid type and status, warranty between 0 and 240, applications still exist, and the Store item exists and is not linked to another product.
- After saving, or on **Cancel**, the user returns to the view page.
- Changes are recorded in the central audit history. This covers product changes, plus each specification change as a child "specification" entry under the product.

#### Statuses & workflow

| Status | Label | Pill colour | Meaning (from code comments and form hint) |
|---|---|---|---|
| development | In development | Blue | A new product that is still being developed. This is the **only** status from which a product can be deleted. It is the default on the New Product form. |
| active | Active | Green | Released for sale. Only Active products should be quoted and sold. This is the database default if no status is sent. |
| phased_out | Phased out | Amber | Still serviced, but no longer sold new. |
| discontinued | Discontinued | Grey | Closed for everything except history. Use this instead of deleting a product that is past development. |

- **How a status changes:** there are no workflow buttons. The status is a plain dropdown on the Create and Edit forms. Any user with Products › edit can move a product from any status to any other. Nothing in the code enforces an order.
- **Approvals:** none. The module is outside the approval engine.
- **Delete rule:** the backend refuses to delete a product that is not In development: "CODE is <status> — only a product still in development can be deleted. Set its status to Discontinued instead so its history is kept." Deleting a product also deletes its specifications and its application tags.
- **Notifications and documents:** none are generated.

### Applications — /dashboard/products/applications

The header title is "Applications". An application is "the job a customer buys the product for". Products are tagged with applications so Sales can find the right product for an enquiry. One application can belong to many products, and one product can have many applications.

#### Create form ("New application" section)

This section is shown only to users with the Applications › create permission. Fields sit in one row with an **Add** button.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Code | text | Yes | Placeholder OHE-INSP | Up to 30 characters. Saved in capitals after trimming spaces. Must be unique (the check ignores upper/lower case). A duplicate gives "Application code '…' already exists (…) — codes are unique; edit it instead", or "…reactivate it from the list (it is retired) instead" if the existing one is retired. The code cannot be changed after it is created. |
| Name | text | Yes | Placeholder "Overhead equipment (OHE) inspection" | Cannot be blank: "Application name is required, e.g. Overhead equipment (OHE) inspection." |
| Description | text | No | Free text | Spaces at the start and end are removed. If left blank it is saved as empty. |

**Add** saves the application, clears the form and reloads the list. The current user is recorded as the creator. The section's hint text: "An application is the job a customer buys the product for. Tag products with it so Sales can find the right product for an enquiry."

#### List view

The list shows **all** applications, active and retired, sorted by name. Retired rows are faded.

| Column | What it shows |
|---|---|
| Code | The application code, in bold. |
| Name | The application name. It becomes a text box while the row is being edited. |
| Description | The description, or "—". It becomes a text box while the row is being edited. |
| Products | How many products are tagged with this application. All products are counted, whatever their status and whatever the user's data scope. |
| Status | "Active" or "Retired". |
| (actions) | Row actions, see below. |

The list has no filters, search or paging. If it is empty it says "No applications yet."

**Row actions** (shown only to users with the Applications › edit permission):

- **Edit**. Switches the row into edit mode, where Name and Description become editable. **Save** stores the change. A blank name is rejected with "Application name can't be blank." **Cancel** leaves edit mode without saving.
- **Retire** (on an active row). Sets the application inactive. A retired application disappears from the Products list's application filter. On the product form it is shown only on products already tagged with it. Products already tagged keep showing it, with "(retired)" added.
- **Reactivate** (on a retired row). Makes the application active again.
- Applications can **never be deleted**. They can only be retired, so the history of tagged products is kept.

#### Statuses & workflow

There are two states, Active and Retired, and you switch between them with Retire and Reactivate. There are no approvals and no notifications.

## 4. Settings / Masters

- **Applications master** (/dashboard/products/applications). This is the only master in the module. It controls the list of applications that products can be tagged with, and the values in the Products list's "All applications" filter. See section 3.
- **Fixed lists, coded and not configurable:**
  - **Product types:** Rail-road vehicle, Machine, Equipment, Attachment / accessory. The code comment says the type decides how a product is built and serviced: a vehicle has a chassis/engine and is commissioned on track, and an attachment is fitted to another product.
  - **Product statuses:** In development, Active, Phased out, Discontinued.
  - Both lists come from the backend endpoint /products/meta.
- The module has no Settings tab.

## 5. Permissions

Access to the module is controlled by the **products** app. Every page calls useRequireApp('products'), and every API route needs app access to "products". A user is counted as having the app if they can view at least one of its tabs. Permissions are granted in Organization › Role & Permissions, as roles plus extra per-user grants, and are deny-by-default. Admins always pass.

| Permission key | Gates |
|---|---|
| products:products:view | Shows the Products tab. |
| products:products:create | Shows the "+ New Product" button. Needed to save a new product (POST /products). |
| products:products:edit | Shows the Edit button on the view page. Needed to save changes (PATCH /products/{id}). |
| products:products:delete | Shows the Delete button (and only on In development products). Checked on the backend through the central "can delete" rule, which looks at the record's creator. |
| products:applications:view | Shows the Applications tab. |
| products:applications:create | Shows the "New application" section. Needed for POST /products/applications. |
| products:applications:edit | Shows the Edit, Retire and Reactivate row actions. Needed for PATCH /products/applications/{id}. |

**Data scope (Products):** set under Organization › Role & Permissions › "Data access".

- Product records are limited by the user's Products data scope. "Own" means products the user created.
- Products have no plant or department column, so plant and department scopes are worked out from the creator's user record.
- If no scope is set, the user sees their own plus assigned records. This is the platform default.
- The scope applies to the product list, the view page, edit and delete. A record outside the scope returns 403.
- **Applications are not scoped.** They are a shared lookup master.
- Note: anyone with the products app can call the Store item lookup used by the form, which lists active Store items without needing the Store app.

## 6. Documents, Notifications & Integrations

- **Generated documents:** none. The module has no Word or PDF output.
- **Notifications:** none. The module sends no bell, email or Teams notifications. The notification bell in the nav bar is the shared app-wide bell.
- **Approvals:** none. The module is outside the central approval engine.
- **Audit history:** product creates and edits, specification row changes (logged as child "specification" entries under their product), and application creates and edits are all recorded in the central audit log under module "products". The audit reference shown is "CODE — Name".
- **Store (integration):** each product can be linked to one active **finished-good Store item** (store_item_id).
  - That Store item is the physical stock/BOM key. Design/Production BOMs and Sales order lines key on Store items, so they can be traced back to the product master through this link.
  - Picking a Store item fills in the HSN code from the item's HSN/SAC code if the HSN field is empty.
  - If the Store item is deleted, the product's link is cleared and the product itself is kept.
- **Service:** the product's default warranty (months) is described in code as the starting point Service uses for a machine's warranty end date.
- **Sales / BD:** applications exist so Sales can find the right product for an enquiry. Only Active products should be quoted or sold. This is guidance shown on the form and is not enforced by this module.
- **Current state:** no other backend module reads the products tables yet. The product master and applications are standalone today. The plan to merge the older CRM product lists and free-text product fields into this master has not been done in code yet.
