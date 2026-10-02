/** Wordmark styled after the ASKKUP cover: charcoal "A…P" around a sage "SKKU". */
export default function Logo({ className = 'text-lg' }: { className?: string }): React.JSX.Element {
  return (
    <h1 className={`font-semibold tracking-tight text-gray-800 ${className}`}>
      A<span className="text-brand-600">SKKU</span>P
    </h1>
  )
}
