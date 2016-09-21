This module defines schema elements and commands to integrate tables
in your editor.

Note that Firefox will, by default, add various kinds of controls to
editable tables, even though those don't work in ProseMirror. The only
way to turn these off is globally, which you might want to do with the
following code:

```javascript
document.execCommand("enableObjectResizing", false, "false")
document.execCommand("enableInlineTableEditing", false, "false")
```

These are the [node specs](#model.NodeSpec) for basic table support:

@table
@tableRow
@tableCell

Two special [step](#transform.Step) implementations are necessary to
atomically add or remove columns. You probably don't have to interact
with these directly.

@AddColumnStep
@RemoveColumnStep

And some utility functions:

@addTableNodes
@createTable

And a number of table-related [commands](#commands):

@addColumnBefore
@addColumnAfter
@removeColumn
@addRowBefore
@addRowAfter
@removeRow
@selectNextCell
@selectPreviousCell
