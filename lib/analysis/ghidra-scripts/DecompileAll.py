# DecompileAll.py - Ghidra headless post-script (Jython).
# Dumps decompiled C for every function (or the names passed as arguments)
# into a text file. Invoked by lib/analysis/ghidra.js:
#   analyzeHeadless <proj> <name> -import <bin> -postScript DecompileAll.py <out> [names]
# @category: Yan.Reverser

from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
import os

args = getScriptArgs()
output_path = args[0] if args else os.path.join(os.getcwd(), 'decompiled.txt')
wanted = set(args[1:]) if len(args) > 1 else None

program = currentProgram
interface = DecompInterface()
interface.openProgram(program)
monitor = ConsoleTaskMonitor()

listing = program.getFunctionManager().getFunctions(True)
lines = ['// decompiled by Yan Reverser via Ghidra headless', '// program: %s' % program.getName(), '']

count = 0
for function in listing:
    name = function.getName()
    if wanted is not None and name not in wanted:
        continue
    result = interface.decompileFunction(function, 60, monitor)
    signature = function.getSignature(True)
    lines.append('// ---- %s @ %s ----' % (name, function.getEntryPoint()))
    if result.decompileCompleted():
        lines.append(result.getDecompiledFunction().getC())
    else:
        lines.append('// decompilation failed: %s' % result.getErrorMessage())
    lines.append('')
    count += 1

with open(output_path, 'w') as handle:
    handle.write('\n'.join(lines))

print('DecompileAll: wrote %d functions to %s' % (count, output_path))
