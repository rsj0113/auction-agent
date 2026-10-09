with open("frontend/src/app/page.tsx", "r") as f:
    content = f.read()

helper = """
function getPropertyType(location: string): string {
  if (!location) return "기타";
  if (location.includes("아파트")) return "🏢 아파트";
  if (location.includes("오피스텔")) return "🏬 오피스텔";
  if (location.includes("다세대") || location.includes("빌라")) return "🏘️ 빌라/다세대";
  if (location.includes("상가") || location.includes("근린")) return "상가/근린시설";
  if (location.includes("산") && location.match(/산\s*[0-9]+/)) return "🌲 임야(산)";
  if (location.includes("임야")) return "🌲 임야(산)";
  if (location.match(/[0-9]+번지/)) return "🗺️ 토지/대지";
  return "🏠 주택/기타";
}
"""

if "function getPropertyType" not in content:
    content = content.replace("export default function Dashboard() {", helper + "\nexport default function Dashboard() {")

content = content.replace(
    '<span className="font-bold text-gray-900">{item.case_number}</span>',
    '<span className="font-bold text-gray-900">{item.case_number}</span>\\n                        <span className="text-[10px] font-medium px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md">\\n                          {getPropertyType(item.location)}\\n                        </span>'
)

content = content.replace(
    '<p className="text-sm text-gray-500">{selectedAuction.location}</p>',
    """<p className="text-sm text-gray-500">
                    <span className="inline-block mb-2 text-xs font-bold px-2 py-0.5 bg-gray-200 text-gray-700 rounded mr-2">
                      {getPropertyType(selectedAuction.location)}
                    </span>
                    {selectedAuction.location}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <a 
                      href={`https://map.kakao.com/link/search/${encodeURIComponent(selectedAuction.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors"
                    >
                      📍 카카오맵 / 로드뷰
                    </a>
                    <a 
                      href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedAuction.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      🗺️ 네이버지도
                    </a>
                  </div>"""
)

with open("frontend/src/app/page.tsx", "w") as f:
    f.write(content.replace("\\n", "\n"))

