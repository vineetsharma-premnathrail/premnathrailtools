export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="text-center">
        <div className="loader mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  )
}
