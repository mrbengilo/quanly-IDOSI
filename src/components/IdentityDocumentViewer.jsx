import './IdentityDocumentViewer.css'

export function IdentityDocumentViewer({ alt, src }) {
  if (!src) return null

  return (
    <figure className="identity-document-viewer" aria-label={alt}>
      <div className="identity-document-viewer__frame">
        <img
          className="identity-document-viewer__image"
          src={src}
          alt={alt}
          decoding="async"
        />
      </div>
    </figure>
  )
}

export default IdentityDocumentViewer
