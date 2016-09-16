This module defines schema elements and commands to integrate tables
in your editor.

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
