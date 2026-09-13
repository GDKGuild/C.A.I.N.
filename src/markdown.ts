const URL_REGEX = String.raw`https?:\/\/(www\.)?[-\w@:%.\+~#=]{1,256}\.[a-z]{2,63}\b([-\w@:%.\+~#=?&//]*)`;

const LEXING_RULES = [
  String.raw`<@!?(\d{15,20})>`,
  String.raw`<@&(\d{15,20})>`,
  String.raw`<\/[\w ]{2,}:(\d{15,20})>`,
  String.raw`<#(\d{15,20})>`,
  String.raw`<t:(-?\d+)(?::([tTdDfFR]))?>`,
  String.raw`<:([\w]{2,}):(\d{15,20})>`,
  String.raw`<a:([\w]{2,}):(\d{15,20})>`,
  String.raw`([\u00a9\u00ae\u2000-\u3300\ud83c\ud000-\udfff\ud83d\ud000-\udfff\ud83e\ud000-\udfff])`,
  String.raw`:([\w]+):`,
  String.raw`\[([^\]]+)\]\(<(${URL_REGEX})>\)`,
  String.raw`\[([^\]]+)\]\((${URL_REGEX})\)`,
  String.raw`<(${URL_REGEX})>`,
  String.raw`${URL_REGEX}`,
  String.raw`(>>)?> `,
  String.raw`~`,
  String.raw`\*`,
  String.raw`_`,
  String.raw`\|\|`,
  String.raw`\`\`\``,
  String.raw`\``,
  String.raw`\n`,
];

const TEXT = LEXING_RULES.length;
const USER = 0;
const ROLE = 1;
const SLASH_COMMAND = 2;
const CHANNEL = 3;
const TIMESTAMP = 4;
const EMOJI_CUSTOM = 5;
const EMOJI_CUSTOM_ANIMATED = 6;
const EMOJI_UNICODE = 7;
const EMOJI_UNICODE_ENCODED = 8;
const URL_WITHOUT_PREVIEW_EMBEDDED = 9;
const URL_WITH_PREVIEW_EMBEDDED = 10;
const URL_WITHOUT_PREVIEW = 11;
const URL_WITH_PREVIEW = 12;
const QUOTE_LINE_PREFIX = 13;
const TILDE = 14;
const STAR = 15;
const UNDERSCORE = 16;
const SPOILER_DELIMITER = 17;
const CODE_BLOCK_DELIMITER = 18;
const CODE_INLINE_DELIMITER = 19;
const NEWLINE = 20;

const compiledRules = LEXING_RULES.map((source) => new RegExp(`^(?:${source})`));

type Token = { value: string; rule: number; groups: Array<string | undefined> };

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let plainText = '';
  while (i < input.length) {
    const rest = input.slice(i);
    let matched = false;
    for (let ri = 0; ri < compiledRules.length; ri++) {
      const m = compiledRules[ri].exec(rest);
      if (m && m[0].length > 0) {
        if (plainText.length > 0) {
          tokens.push({ value: plainText, rule: TEXT, groups: [] });
          plainText = '';
        }
        tokens.push({ value: m[0], rule: ri, groups: m.slice(1) });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plainText += rest[0];
      i += 1;
    }
  }
  if (plainText.length > 0) {
    tokens.push({ value: plainText, rule: TEXT, groups: [] });
  }
  return tokens;
}

export type MarkdownNode = {
  node_type: string;
  content?: string | null;
  url?: string | null;
  children: MarkdownNode[];
};

function searchForCloser(tokens: Token[], closer: number[]): [Token[] | null, number | null] {
  for (let ti = 0; ti <= tokens.length - closer.length; ti++) {
    let ok = true;
    for (let ci = 0; ci < closer.length; ci++) {
      if (tokens[ti + ci].rule !== closer[ci]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return [tokens.slice(0, ti), ti + closer.length];
    }
  }
  return [null, null];
}

function tryParseNodeWithChildren(
  tokens: Token[],
  opener: number[],
  closer: number[],
  nodeType: string,
  inQuote: boolean,
): [MarkdownNode | null, number | null] {
  if (tokens.length < opener.length + 1 + closer.length) return [null, null];
  for (let oi = 0; oi < opener.length; oi++) {
    if (tokens[oi].rule !== opener[oi]) return [null, null];
  }
  const [foundChildren, foundConsumed] = searchForCloser(tokens.slice(opener.length + 1), closer);
  if (foundChildren === null) return [null, null];
  const childrenTokens = [tokens[opener.length], ...foundChildren];
  const consumed = (foundConsumed as number) + opener.length + 1;
  const content = childrenTokens.map((t) => t.value).join('');
  return [
    { node_type: nodeType, content, children: parseTokensGenerator(childrenTokens, inQuote) },
    consumed,
  ];
}

const LANG_SPEC = /^([a-zA-Z0-9-]*)(.*)$/;
const MODIFIERS: Array<[number[], number[], string]> = [
  [[STAR, STAR], [STAR, STAR], 'BOLD'],
  [[UNDERSCORE, UNDERSCORE], [UNDERSCORE, UNDERSCORE], 'UNDERLINE'],
  [[TILDE, TILDE], [TILDE, TILDE], 'STRIKETHROUGH'],
  [[STAR], [STAR], 'ITALIC'],
  [[UNDERSCORE], [UNDERSCORE], 'ITALIC'],
  [[SPOILER_DELIMITER], [SPOILER_DELIMITER], 'SPOILER'],
  [[CODE_INLINE_DELIMITER], [CODE_INLINE_DELIMITER], 'CODE_INLINE'],
];

function findEmojiUrl(rule: number, id: string | undefined): string {
  if (rule === EMOJI_CUSTOM) return `https://cdn.discordapp.com/emojis/${id}.png`;
  if (rule === EMOJI_CUSTOM_ANIMATED) return `https://cdn.discordapp.com/emojis/${id}.gif`;
  return '';
}

function parseTokensGenerator(tokens: Token[], inQuote = false): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const rule = token.rule;

    if (rule === TEXT) {
      out.push({ node_type: 'TEXT', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === USER) {
      out.push({ node_type: 'USER', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === ROLE) {
      out.push({ node_type: 'ROLE', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === TIMESTAMP) {
      out.push({ node_type: 'TIMESTAMP', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === CHANNEL) {
      out.push({ node_type: 'CHANNEL', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === SLASH_COMMAND) {
      out.push({ node_type: 'SLASH_COMMAND', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === EMOJI_CUSTOM || rule === EMOJI_CUSTOM_ANIMATED) {
      out.push({ node_type: rule === EMOJI_CUSTOM ? 'EMOJI_CUSTOM' : 'EMOJI_CUSTOM_ANIMATED', content: token.value, url: findEmojiUrl(rule, token.groups[1]), children: [] });
      i++;
      continue;
    }
    if (rule === EMOJI_UNICODE) {
      out.push({ node_type: 'EMOJI_UNICODE', content: token.value[0], children: [] });
      i++;
      continue;
    }
    if (rule === EMOJI_UNICODE_ENCODED) {
      out.push({ node_type: 'EMOJI_UNICODE_ENCODED', content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === URL_WITH_PREVIEW_EMBEDDED) {
      out.push({ node_type: 'URL_WITH_PREVIEW_EMBEDDED', url: token.groups[1], content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === URL_WITHOUT_PREVIEW_EMBEDDED) {
      out.push({ node_type: 'URL_WITHOUT_PREVIEW_EMBEDDED', url: token.groups[1], content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === URL_WITH_PREVIEW) {
      out.push({ node_type: 'URL_WITH_PREVIEW', url: token.value, content: token.value, children: [] });
      i++;
      continue;
    }
    if (rule === URL_WITHOUT_PREVIEW) {
      out.push({ node_type: 'URL_WITHOUT_PREVIEW', url: token.value.slice(1, -1), content: token.value, children: [] });
      i++;
      continue;
    }

    let modifierParsed = false;
    for (const [opener, closer, nodeType] of MODIFIERS) {
      const [node, consumed] = tryParseNodeWithChildren(tokens.slice(i), opener, closer, nodeType, inQuote);
      if (node !== null) {
        out.push(node);
        i += consumed as number;
        modifierParsed = true;
        break;
      }
    }
    if (modifierParsed) continue;

    if (rule === CODE_BLOCK_DELIMITER) {
      const [childrenToken, amount] = searchForCloser(tokens.slice(i + 1), [CODE_BLOCK_DELIMITER]);
      if (childrenToken !== null) {
        let childrenContent = childrenToken.map((t) => t.value).join('');
        const lines = childrenContent.split('\n');
        let nonEmptyLineFound = false;
        let lang: string | null = null;
        for (let li = 1; li < lines.length; li++) {
          if (lines[li].length > 0) {
            nonEmptyLineFound = true;
            break;
          }
        }
        if (nonEmptyLineFound) {
          const match = LANG_SPEC.exec(lines[0]);
          if (match && match[2].length === 0) {
            lines.shift();
            if (match[1].length > 0) lang = match[1];
          }
        }
        childrenContent = lines.join('\n');
        out.push({ node_type: 'CODE_BLOCK', content: childrenContent, children: [] });
        i += 1 + (amount as number);
        continue;
      }
    }

    const quoteChildren: Token[] = [];
    while (!inQuote && i < tokens.length && tokens[i].rule === QUOTE_LINE_PREFIX) {
      let foundNewline = false;
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].rule === NEWLINE) {
          quoteChildren.push(...tokens.slice(i + 1, j + 1));
          i = j + 1;
          foundNewline = true;
          break;
        }
      }
      if (!foundNewline) {
        quoteChildren.push(...tokens.slice(i + 1));
        i = tokens.length;
        break;
      }
    }
    if (quoteChildren.length > 0) {
      out.push({
        node_type: 'QUOTE_BLOCK',
        content: quoteChildren.map((t) => t.value).join(''),
        children: parseTokensGenerator(quoteChildren, true),
      });
      continue;
    }

    out.push({ node_type: 'TEXT', content: token.value, children: [] });
    i++;
  }
  return out;
}

export function parse(input: string): MarkdownNode[] {
  const tokens = lex(input);
  const t: Token[] = [];
  for (const token of tokens) {
    if (token.rule === TEXT && t.length > 0 && t[t.length - 1].rule === TEXT) {
      t[t.length - 1].value += token.value;
    } else {
      t.push({ ...token });
    }
  }
  return parseTokensGenerator(t);
}

export type EmbeddableUrl = { url: string; spoiler: boolean };

export function getEmbeddableUrls(nodes: MarkdownNode[], spoiler = false): EmbeddableUrl[] {
  const links: EmbeddableUrl[] = [];
  for (const node of nodes) {
    if (node.node_type === 'CODE_BLOCK' || node.node_type === 'CODE_INLINE') continue;
    if (node.node_type === 'URL_WITH_PREVIEW_EMBEDDED' || node.node_type === 'URL_WITH_PREVIEW') {
      links.push({ url: node.url!, spoiler });
      continue;
    }
    if (node.node_type === 'SPOILER') {
      links.push(...getEmbeddableUrls(node.children, true));
      continue;
    }
    links.push(...getEmbeddableUrls(node.children, spoiler));
  }
  return links;
}