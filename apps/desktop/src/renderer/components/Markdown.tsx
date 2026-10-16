import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Raw HTML is never rendered (react-markdown's default). Links go through the main process's allow-list,
// and images are shown as their alt text so a message can't load anything from the network.
const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mb-1 mt-3 font-semibold first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 marker:text-faint">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-muted">{children}</blockquote>,
  hr: () => <hr className="my-3 border-line" />,
  code: ({ children }) => <code className="rounded-md bg-control px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-control p-3 font-mono text-[12.5px] [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  a: ({ children, href }) => (
    <button
      type="button"
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      onClick={() => {
        if (href) void window.shopifyBuilder?.openExternal(href)
      }}
    >
      {children}
    </button>
  ),
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top">{children}</td>,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  )
}
