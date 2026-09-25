/**
 * Tiny, safe evaluator for remark conditions such as
 *   "total_pct >= 70 and knowledge_pct >= behaviour_pct + 20"
 * Supports numbers, variables, + - * /, parentheses, comparisons
 * (>= <= > < == !=) and and/or/not (also &&, ||, !). No eval().
 * A missing variable (e.g. no behaviour questions) makes a comparison false.
 */

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|&&|\|\||[-+*/()<>!]))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Unexpected character at position ${pos + 1}: "${src.slice(pos, pos + 10)}"`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) {
      const w = m[2].toLowerCase();
      if (w === 'and') tokens.push({ t: 'op', v: '&&' });
      else if (w === 'or') tokens.push({ t: 'op', v: '||' });
      else if (w === 'not') tokens.push({ t: 'op', v: '!' });
      else if (w === 'true' || w === 'false') tokens.push({ t: 'num', v: w === 'true' ? 1 : 0 });
      else tokens.push({ t: 'id', v: w });
    } else tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

/** Parse into an AST. Throws a readable error for invalid syntax. */
function parse(src) {
  const tokens = tokenize(String(src || ''));
  let i = 0;
  const peek = () => tokens[i];
  const take = (v) => {
    const tok = tokens[i];
    if (tok && tok.t === 'op' && tok.v === v) {
      i += 1;
      return true;
    }
    return false;
  };

  function primary() {
    const tok = tokens[i];
    if (!tok) throw new Error('Condition ends too early');
    if (take('(')) {
      const e = or();
      if (!take(')')) throw new Error('Missing ")"');
      return e;
    }
    if (take('-')) return { k: 'neg', a: primary() };
    if (take('!')) return { k: 'not', a: primary() };
    i += 1;
    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'id') return { k: 'var', v: tok.v };
    throw new Error(`Unexpected "${tok.v}"`);
  }
  function mul() {
    let e = primary();
    for (;;) {
      if (take('*')) e = { k: '*', a: e, b: primary() };
      else if (take('/')) e = { k: '/', a: e, b: primary() };
      else return e;
    }
  }
  function add() {
    let e = mul();
    for (;;) {
      if (take('+')) e = { k: '+', a: e, b: mul() };
      else if (take('-')) e = { k: '-', a: e, b: mul() };
      else return e;
    }
  }
  function cmp() {
    const e = add();
    for (const op of ['>=', '<=', '==', '!=', '>', '<']) if (take(op)) return { k: op, a: e, b: add() };
    return e;
  }
  function and() {
    let e = cmp();
    while (take('&&')) e = { k: '&&', a: e, b: cmp() };
    return e;
  }
  function or() {
    let e = and();
    while (take('||')) e = { k: '||', a: e, b: and() };
    return e;
  }

  const ast = or();
  if (i < tokens.length) throw new Error(`Unexpected "${peek().v}"`);
  return ast;
}

function variables(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'var') out.add(ast.v);
  variables(ast.a, out);
  variables(ast.b, out);
  return out;
}

function evalAst(ast, vars) {
  const num = (n) => evalAst(n, vars);
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'var': {
      const v = vars[ast.v];
      return v === null || v === undefined || v === '' ? NaN : Number(v);
    }
    case 'neg':
      return -num(ast.a);
    case 'not':
      return !truthy(num(ast.a));
    case '+':
      return num(ast.a) + num(ast.b);
    case '-':
      return num(ast.a) - num(ast.b);
    case '*':
      return num(ast.a) * num(ast.b);
    case '/':
      return num(ast.a) / num(ast.b);
    case '>=':
      return num(ast.a) >= num(ast.b);
    case '<=':
      return num(ast.a) <= num(ast.b);
    case '>':
      return num(ast.a) > num(ast.b);
    case '<':
      return num(ast.a) < num(ast.b);
    case '==':
      return num(ast.a) === num(ast.b);
    case '!=':
      return num(ast.a) !== num(ast.b);
    case '&&':
      return truthy(num(ast.a)) && truthy(num(ast.b));
    case '||':
      return truthy(num(ast.a)) || truthy(num(ast.b));
    default:
      throw new Error(`Unknown node ${ast.k}`);
  }
}

function truthy(v) {
  return typeof v === 'boolean' ? v : Number.isFinite(v) && v !== 0;
}

/** Validate a condition; returns an error message or null. */
function validate(src, allowedVars) {
  try {
    const ast = parse(src);
    const unknown = [...variables(ast)].filter((v) => !allowedVars(v));
    if (unknown.length) return `Unknown variable: ${unknown.join(', ')}`;
    return null;
  } catch (e) {
    return e.message;
  }
}

function evaluate(src, vars) {
  return truthy(evalAst(parse(src), vars));
}

module.exports = { parse, evaluate, validate, variables };
