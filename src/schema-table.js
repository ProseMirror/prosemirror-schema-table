const {Fragment, Slice} = require("prosemirror-model")
const {Step, StepResult, StepMap, ReplaceStep} = require("prosemirror-transform")
const {Selection} = require("prosemirror-state")

// :: NodeSpec
// A table node spec. Has one attribute, **`columns`**, which holds
// a number indicating the amount of columns in the table.
const table = {
  attrs: {columns: {default: 1}},
  parseDOM: [{tag: "table", getAttrs(dom) {
    let row = dom.querySelector("tr")
    if (!row || !row.children.length) return false
    // FIXME using the child count as column width is problematic
    // when parsing document fragments
    return {columns: row.children.length}
  }}],
  toDOM() { return ["table", ["tbody", 0]] }
}
exports.table = table

// :: NodeSpec
// A table row node spec. Has one attribute, **`columns`**, which
// holds a number indicating the amount of columns in the table.
const tableRow = {
  attrs: {columns: {default: 1}},
  parseDOM: [{tag: "tr", getAttrs: dom => dom.children.length ? {columns: dom.children.length} : false}],
  toDOM() { return ["tr", 0] },
  tableRow: true
}
exports.tableRow = tableRow

// :: NodeSpec
// A table cell node spec.
const tableCell = {
  parseDOM: [{tag: "td"}],
  toDOM() { return ["td", 0] }
}
exports.tableCell = tableCell

function add(obj, props) {
  let copy = {}
  for (let prop in obj) copy[prop] = obj[prop]
  for (let prop in props) copy[prop] = props[prop]
  return copy
}

// :: (OrderedMap, string, ?string) → OrderedMap
// Convenience function for adding table-related node types to a map
// describing the nodes in a schema. Adds `Table` as `"table"`,
// `TableRow` as `"table_row"`, and `TableCell` as `"table_cell"`.
// `cellContent` should be a content expression describing what may
// occur inside cells.
function addTableNodes(nodes, cellContent, tableGroup) {
  return nodes.append({
    table: add(table, {content: "table_row[columns=.columns]+", group: tableGroup}),
    table_row: add(tableRow, {content: "table_cell{.columns}"}),
    table_cell: add(tableCell, {content: cellContent})
  })
}
exports.addTableNodes = addTableNodes

// :: (NodeType, number, number, ?Object) → Node
// Create a table node with the given number of rows and columns.
function createTable(nodeType, rows, columns, attrs) {
  attrs = setColumns(attrs, columns)
  let rowType = nodeType.contentExpr.elements[0].nodeTypes[0]
  let cellType = rowType.contentExpr.elements[0].nodeTypes[0]
  let cell = cellType.createAndFill(), cells = []
  for (let i = 0; i < columns; i++) cells.push(cell)
  let row = rowType.create({columns}, Fragment.from(cells)), rowNodes = []
  for (let i = 0; i < rows; i++) rowNodes.push(row)
  return nodeType.create(attrs, Fragment.from(rowNodes))
}
exports.createTable = createTable

// Steps to add and remove a column

function setColumns(attrs, columns) {
  let result = Object.create(null)
  if (attrs) for (let prop in attrs) result[prop] = attrs[prop]
  result.columns = columns
  return result
}

function adjustColumns(attrs, diff) {
  return setColumns(attrs, attrs.columns + diff)
}

// ::- A `Step` subclass for adding a column to a table in a single
// atomic step.
class AddColumnStep extends Step {
  constructor(positions, cells) {
    super()
    this.positions = positions
    this.cells = cells
  }

  // :: (Node, number, number, NodeType, ?Object) → AddColumnStep
  // Create a step that inserts a column into the table after
  // `tablePos`, at the index given by `columnIndex`, using cells with
  // the given type and attributes.
  static create(doc, tablePos, columnIndex, cellType, cellAttrs) {
    let cell = cellType.createAndFill(cellAttrs)
    let positions = [], cells = []
    let table = doc.nodeAt(tablePos)
    table.forEach((row, rowOff) => {
      let cellPos = tablePos + 2 + rowOff
      for (let i = 0; i < columnIndex; i++) cellPos += row.child(i).nodeSize
      positions.push(cellPos)
      cells.push(cell)
    })
    return new AddColumnStep(positions, cells)
  }

  apply(doc) {
    let index = null, table = null, tablePos = null
    for (let i = 0; i < this.positions.length; i++) {
      let $pos = doc.resolve(this.positions[i])
      if ($pos.depth < 2 || $pos.index(-1) != i)
        return StepResult.fail("Invalid cell insert position")
      if (table == null) {
        table = $pos.node(-1)
        if (table.childCount != this.positions.length)
          return StepResult.fail("Mismatch in number of rows")
        tablePos = $pos.before(-1)
        index = $pos.index()
      } else if ($pos.before(-1) != tablePos || $pos.index() != index) {
        return StepResult.fail("Column insert positions not consistent")
      }
    }

    let updatedRows = []
    for (let i = 0; i < table.childCount; i++) {
      let row = table.child(i), rowCells = index ? [] : [this.cells[i]]
      for (let j = 0; j < row.childCount; j++) {
        rowCells.push(row.child(j))
        if (j + 1 == index) rowCells.push(this.cells[i])
      }
      updatedRows.push(row.type.create(adjustColumns(row.attrs, 1), Fragment.from(rowCells)))
    }
    let updatedTable = table.type.create(adjustColumns(table.attrs, 1),  Fragment.from(updatedRows))
    return StepResult.fromReplace(doc, tablePos, tablePos + table.nodeSize,
                                  new Slice(Fragment.from(updatedTable), 0, 0))
  }

  getMap() {
    let ranges = []
    for (let i = 0; i < this.positions.length; i++)
      ranges.push(this.positions[i], 0, this.cells[i].nodeSize)
    return new StepMap(ranges)
  }

  invert(doc) {
    let $first = doc.resolve(this.positions[0])
    let table = $first.node(-1)
    let from = [], to = [], dPos = 0
    for (let i = 0; i < table.childCount; i++) {
      let pos = this.positions[i] + dPos, size = this.cells[i].nodeSize
      from.push(pos)
      to.push(pos + size)
      dPos += size
    }
    return new RemoveColumnStep(from, to)
  }

  map(mapping) {
    return new AddColumnStep(this.positions.map(p => mapping.map(p)), this.cells)
  }

  toJSON() {
    return {stepType: this.jsonID,
            positions: this.positions,
            cells: this.cells.map(c => c.toJSON())}
  }

  static fromJSON(schema, json) {
    return new AddColumnStep(json.positions, json.cells.map(schema.nodeFromJSON))
  }
}
exports.AddColumnStep = AddColumnStep

Step.jsonID("addTableColumn", AddColumnStep)

// ::- A subclass of `Step` that removes a column from a table.
class RemoveColumnStep extends Step {
  constructor(from, to) {
    super()
    this.from = from
    this.to = to
  }

  // :: (Node, number, number) → RemoveColumnStep
  // Create a step that deletes the column at `columnIndex` in the
  // table after `tablePos`.
  static create(doc, tablePos, columnIndex) {
    let from = [], to = []
    let table = doc.nodeAt(tablePos)
    table.forEach((row, rowOff) => {
      let cellPos = tablePos + 2 + rowOff
      for (let i = 0; i < columnIndex; i++) cellPos += row.child(i).nodeSize
      from.push(cellPos)
      to.push(cellPos + row.child(columnIndex).nodeSize)
    })
    return new RemoveColumnStep(from, to)
  }

  apply(doc) {
    let index = null, table = null, tablePos = null
    for (let i = 0; i < this.from.length; i++) {
      let $from = doc.resolve(this.from[i]), after = $from.nodeAfter
      if ($from.depth < 2 || $from.index(-1) != i || !after || this.from[i] + after.nodeSize != this.to[i])
        return StepResult.fail("Invalid cell delete positions")
      if (table == null) {
        table = $from.node(-1)
        if (table.childCount != this.from.length)
          return StepResult.fail("Mismatch in number of rows")
        tablePos = $from.before(-1)
        index = $from.index()
      } else if ($from.before(-1) != tablePos || $from.index() != index) {
        return StepResult.fail("Column delete positions not consistent")
      }
    }

    let updatedRows = []
    for (let i = 0; i < table.childCount; i++) {
      let row = table.child(i), rowCells = []
      for (let j = 0; j < row.childCount; j++)
        if (j != index) rowCells.push(row.child(j))
      updatedRows.push(row.type.create(adjustColumns(row.attrs, -1), Fragment.from(rowCells)))
    }
    let updatedTable = table.type.create(adjustColumns(table.attrs, -1),  Fragment.from(updatedRows))
    return StepResult.fromReplace(doc, tablePos, tablePos + table.nodeSize,
                                  new Slice(Fragment.from(updatedTable), 0, 0))
  }

  getMap() {
    let ranges = []
    for (let i = 0; i < this.from.length; i++)
      ranges.push(this.from[i], this.to[i] - this.from[i], 0)
    return new StepMap(ranges)
  }

  invert(doc) {
    let $first = doc.resolve(this.from[0])
    let table = $first.node(-1), index = $first.index()
    let positions = [], cells = [], dPos = 0
    for (let i = 0; i < table.childCount; i++) {
      positions.push(this.from[i] - dPos)
      let cell = table.child(i).child(index)
      dPos += cell.nodeSize
      cells.push(cell)
    }
    return new AddColumnStep(positions, cells)
  }

  map(mapping) {
    let from = [], to = []
    for (let i = 0; i < this.from.length; i++) {
      let start = mapping.map(this.from[i], 1), end = mapping.map(this.to[i], -1)
      if (end <= start) return null
      from.push(start)
      to.push(end)
    }
    return new RemoveColumnStep(from, to)
  }

  static fromJSON(_schema, json) {
    return new RemoveColumnStep(json.from, json.to)
  }
}
exports.RemoveColumnStep = RemoveColumnStep

Step.jsonID("removeTableColumn", RemoveColumnStep)

// Table-related command functions

function findRow($pos, pred) {
  for (let d = $pos.depth; d > 0; d--)
    if ($pos.node(d).type.spec.tableRow && (!pred || pred(d))) return d
  return -1
}

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that adds a column before the column with the
// selection.
function addColumnBefore(state, onAction) {
  let $from = state.selection.$from, cellFrom
  let rowDepth = findRow($from, d => cellFrom = d == $from.depth ? $from.nodeBefore : $from.node(d + 1))
  if (rowDepth == -1) return false
  if (onAction)
    onAction(state.tr.step(AddColumnStep.create(state.doc, $from.before(rowDepth - 1), $from.index(rowDepth),
                                                cellFrom.type, cellFrom.attrs)).action())
  return true
}
exports.addColumnBefore = addColumnBefore

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that adds a column after the column with the
// selection.
function addColumnAfter(state, onAction) {
  let $from = state.selection.$from, cellFrom
  let rowDepth = findRow($from, d => cellFrom = d == $from.depth ? $from.nodeAfter : $from.node(d + 1))
  if (rowDepth == -1) return false
  if (onAction)
    onAction(state.tr.step(AddColumnStep.create(state.doc, $from.before(rowDepth - 1),
                                                $from.indexAfter(rowDepth) + (rowDepth == $from.depth ? 1 : 0),
                                                cellFrom.type, cellFrom.attrs)).action())
  return true
}
exports.addColumnAfter = addColumnAfter

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that removes the column with the selection.
function removeColumn(state, onAction) {
  let $from = state.selection.$from
  let rowDepth = findRow($from, d => $from.node(d).childCount > 1)
  if (rowDepth == -1) return false
  if (onAction)
    onAction(state.tr.step(RemoveColumnStep.create(state.doc, $from.before(rowDepth - 1), $from.index(rowDepth))).action())
  return true
}
exports.removeColumn = removeColumn

function addRow(state, onAction, side) {
  let $from = state.selection.$from
  let rowDepth = findRow($from)
  if (rowDepth == -1) return false
  if (onAction) {
    let exampleRow = $from.node(rowDepth)
    let cells = [], pos = side < 0 ? $from.before(rowDepth) : $from.after(rowDepth)
    exampleRow.forEach(cell => cells.push(cell.type.createAndFill(cell.attrs)))
    let row = exampleRow.copy(Fragment.from(cells))
    onAction(state.tr.step(new ReplaceStep(pos, pos, new Slice(Fragment.from(row), 0, 0))).action())
  }
  return true
}

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that adds a row after the row with the
// selection.
function addRowBefore(state, onAction) {
  return addRow(state, onAction, -1)
}
exports.addRowBefore = addRowBefore

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that adds a row before the row with the
// selection.
function addRowAfter(state, onAction) {
  return addRow(state, onAction, 1)
}
exports.addRowAfter = addRowAfter

// :: (EditorState, onAction: ?(action: Action)) → bool
// Command function that removes the row with the selection.
function removeRow(state, onAction) {
  let $from = state.selection.$from
  let rowDepth = findRow($from, d => $from.node(d - 1).childCount > 1)
  if (rowDepth == -1) return false
  if (onAction)
    onAction(state.tr.step(new ReplaceStep($from.before(rowDepth), $from.after(rowDepth), Slice.empty)).action())
  return true
}
exports.removeRow = removeRow

function moveCell(state, dir, onAction) {
  let {$from} = state.selection
  let rowDepth = findRow($from)
  if (rowDepth == -1) return false
  let row = $from.node(rowDepth), newIndex = $from.index(rowDepth) + dir
  if (newIndex >= 0 && newIndex < row.childCount) {
    let $cellStart = state.doc.resolve(row.content.offsetAt(newIndex) + $from.start(rowDepth))
    let sel = Selection.findFrom($cellStart, 1)
    if (!sel || sel.from >= $cellStart.end()) return false
    if (onAction) onAction(sel.scrollAction())
    return true
  } else {
    let rowIndex = $from.index(rowDepth - 1) + dir, table = $from.node(rowDepth - 1)
    if (rowIndex < 0 || rowIndex >= table.childCount) return false
    let cellStart = dir > 0 ? $from.after(rowDepth) + 2 : $from.before(rowDepth) - 2 - table.child(rowIndex).lastChild.content.size
    let $cellStart = state.doc.resolve(cellStart), sel = Selection.findFrom($cellStart, 1)
    if (!sel || sel.from >= $cellStart.end()) return false
    if (onAction) onAction(sel.scrollAction())
    return true
  }
}

// :: (EditorState, onAction: ?(action: Action)) → bool
// Move to the next cell in the current table, if there is one.
function selectNextCell(state, onAction) { return moveCell(state, 1, onAction) }
exports.selectNextCell = selectNextCell

// :: (EditorState, onAction: ?(action: Action)) → bool
// Move to the previous cell in the current table, if there is one.
function selectPreviousCell(state, onAction) { return moveCell(state, -1, onAction) }
exports.selectPreviousCell = selectPreviousCell
