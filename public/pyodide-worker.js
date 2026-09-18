let pyodideReadyPromise
let mountedFiles = []
const turtleModule = `
import math
commands = []
_x, _y, _angle = 320.0, 210.0, 0.0
_pen_down, _color, _width = True, "#27725c", 2.0

def makeTurtle(*args, **kwargs):
  global _x, _y, _angle
  _x, _y, _angle = 320.0, 210.0, 0.0
  commands.clear()

def clear(*args, **kwargs):
  commands.clear()

def penUp():
  global _pen_down
  _pen_down = False

def penDown():
  global _pen_down
  _pen_down = True

def forward(distance):
  global _x, _y
  next_x = _x + math.cos(math.radians(_angle)) * distance
  next_y = _y + math.sin(math.radians(_angle)) * distance
  if _pen_down:
    commands.append({"type": "line", "x1": _x, "y1": _y, "x2": next_x, "y2": next_y, "color": _color, "width": _width})
  _x, _y = next_x, next_y

def backward(distance):
  forward(-distance)

def left(degrees):
  global _angle
  _angle += degrees

def right(degrees):
  left(-degrees)

def setPenColor(color):
  global _color
  _color = color

def setLineWidth(width):
  global _width
  _width = width
`

async function getPyodide() {
  if (!pyodideReadyPromise) {
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js')
    pyodideReadyPromise = loadPyodide()
  }
  return pyodideReadyPromise
}

self.onmessage = async (event) => {
  if (event.data.type !== 'run') return
  try {
    const pyodide = await getPyodide()
    const files = event.data.project.files
    for (const path of mountedFiles) {
      try { pyodide.FS.unlink(`/${path}`) } catch {}
    }
    mountedFiles = []
    for (const [path, code] of Object.entries(files)) {
      const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (directory) pyodide.FS.mkdirTree(`/${directory}`)
      pyodide.FS.writeFile(`/${path}`, code)
      mountedFiles.push(path)
    }
    pyodide.FS.writeFile('/gturtle.py', turtleModule)
    let output = ''
    pyodide.setStdout({ batched: (text) => { output += `${text}\n` } })
    pyodide.setStderr({ batched: (text) => { output += `${text}\n` } })
    await pyodide.runPythonAsync(`import runpy\nimport sys\nsys.path.insert(0, "/")\nrunpy.run_path(${JSON.stringify(`/${event.data.project.mainFile}`)}, run_name="__main__")`)
    const graphicsJson = await pyodide.runPythonAsync('import json, gturtle\njson.dumps(gturtle.commands)')
    self.postMessage({ type: 'result', output: output.trim(), graphics: JSON.parse(String(graphicsJson)) })
  } catch (error) {
    self.postMessage({ type: 'error', output: String(error) })
  }
}

getPyodide().then(() => self.postMessage({ type: 'ready' })).catch(() => self.postMessage({ type: 'error', output: 'Could not load the Python runtime. Check your network connection.' }))