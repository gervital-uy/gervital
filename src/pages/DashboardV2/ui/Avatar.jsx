// Foto del cliente o sus iniciales. Copia del Avatar de CollectionPanel (legacy no
// lo exporta y no se toca).
export default function Avatar({ firstName, lastName, avatarUrl }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${firstName || ''} ${lastName || ''}`.trim()}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
      />
    )
  }
  const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
  return (
    <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
      {initials || '–'}
    </div>
  )
}
