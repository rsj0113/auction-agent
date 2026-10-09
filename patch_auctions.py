import re

with open("frontend/src/app/auctions/page.tsx", "r") as f:
    content = f.read()

# Add states
content = content.replace(
    'const [sortOrder, setSortOrder] = useState<string>("recent");',
    'const [sortOrder, setSortOrder] = useState<string>("recent");\n  const [propertyTypeFilter, setPropertyTypeFilter] = useState<string>("");\n  const [regionFilter, setRegionFilter] = useState<string>("");'
)

# Update fetchAuctions signature & logic
old_fetch = """  const fetchAuctions = async (pageIndex: number, overrideParams?: { grade?: string, price?: string, sort?: string }) => {
    try {
      if (pageIndex === 0) setLoading(true);
      const grade = overrideParams?.grade ?? gradeFilter;
      const price = overrideParams?.price ?? priceFilter;
      const sort = overrideParams?.sort ?? sortOrder;
      
      let url = `/api/auctions?limit=20&offset=${pageIndex * 20}`;
      if (grade) url += `&grade=${grade}`;
      if (sort) url += `&sort=${sort}`;
      if (price) {"""

new_fetch = """  const fetchAuctions = async (pageIndex: number, overrideParams?: { grade?: string, price?: string, sort?: string, propertyType?: string, region?: string }) => {
    try {
      if (pageIndex === 0) setLoading(true);
      const grade = overrideParams?.grade ?? gradeFilter;
      const price = overrideParams?.price ?? priceFilter;
      const sort = overrideParams?.sort ?? sortOrder;
      const propertyType = overrideParams?.propertyType ?? propertyTypeFilter;
      const region = overrideParams?.region ?? regionFilter;
      
      let url = `/api/auctions?limit=20&offset=${pageIndex * 20}`;
      if (grade) url += `&grade=${grade}`;
      if (sort) url += `&sort=${sort}`;
      if (propertyType) url += `&property_type=${propertyType}`;
      if (region) url += `&region=${encodeURIComponent(region)}`;
      if (price) {"""

content = content.replace(old_fetch, new_fetch)

# Update useEffect
old_effect = """  useEffect(() => {
    fetchAuctions(0);
  }, [gradeFilter, priceFilter, sortOrder]);"""

new_effect = """  useEffect(() => {
    // debounce fetching if regionFilter is typed quickly
    const timer = setTimeout(() => {
      fetchAuctions(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [gradeFilter, priceFilter, sortOrder, propertyTypeFilter, regionFilter]);"""

content = content.replace(old_effect, new_effect)

# Update UI
ui_controls = """        {/* Filters */}
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex gap-2">
            <select 
              value={propertyTypeFilter} 
              onChange={(e) => setPropertyTypeFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">전체 매물</option>
              <option value="apartment">아파트</option>
              <option value="officetel">오피스텔</option>
              <option value="villa">빌라/다세대</option>
              <option value="commercial">상가/근린</option>
              <option value="land">임야/토지</option>
            </select>
            
            <input 
              type="text"
              placeholder="지역 검색 (예: 강남구)"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={gradeFilter} 
              onChange={(e) => setGradeFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">모든 등급</option>
              <option value="S">S 등급</option>
              <option value="A">A 등급</option>
              <option value="B">B 등급</option>
              <option value="C">C 등급</option>
              <option value="D">D 등급</option>
            </select>

            <select 
              value={priceFilter} 
              onChange={(e) => setPriceFilter(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="">가격 전체</option>
              <option value="under1">1억 미만</option>
              <option value="1to3">1억 ~ 3억</option>
              <option value="3to5">3억 ~ 5억</option>
              <option value="over5">5억 이상</option>
            </select>

            <select 
              value={sortOrder} 
              onChange={(e) => setSortOrder(e.target.value)}
              className="flex-1 text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 outline-none focus:border-blue-500 shadow-sm"
            >
              <option value="recommend">추천순(S/A)</option>
              <option value="recent">최신 등록순</option>
              <option value="oldest">오래된 등록순</option>
              <option value="price_asc">낮은 가격순</option>
              <option value="price_desc">높은 가격순</option>
            </select>
          </div>
        </div>"""

old_ui_regex = r"\{\/\* Filters \*\/\}.*?(?=<div className=\"grid grid-cols-1 gap-4\">)"
content = re.sub(old_ui_regex, ui_controls + "\n\n        ", content, flags=re.DOTALL)

with open("frontend/src/app/auctions/page.tsx", "w") as f:
    f.write(content)

print("Frontend patched")
