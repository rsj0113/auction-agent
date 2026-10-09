import re

with open("frontend/src/app/page.tsx", "r") as f:
    page_content = f.read()

with open("frontend/src/app/auctions/page.tsx", "r") as f:
    auctions_content = f.read()

# Fix UNCHANGED
page_content = page_content.replace(
    "item.status_flag === 'unchanged' ? '기일변경' : item.status_flag",
    "item.status_flag?.toUpperCase() === 'UNCHANGED' ? '기일변경' : item.status_flag"
)

# getGradeColor from auctions
grade_color_func = """
function getGradeColor(grade: string) {
  if (!grade) return 'bg-gray-100 text-gray-500 border-gray-200';
  const g = grade.toUpperCase();
  if (g === 'S') return 'bg-red-50 text-red-600 border-red-200';
  if (g === 'A') return 'bg-blue-50 text-blue-600 border-blue-200';
  if (g === 'B') return 'bg-green-50 text-green-600 border-green-200';
  if (g === 'C') return 'bg-yellow-50 text-yellow-600 border-yellow-200';
  if (g === 'D') return 'bg-gray-50 text-gray-600 border-gray-200';
  return 'bg-gray-100 text-gray-500 border-gray-200';
}
"""

if "function getGradeColor" not in page_content:
    page_content = page_content.replace("export default function Home()", grade_color_func + "\nexport default function Home()")

# extract modal from auctions_content
modal_start_token = "{/* 모달 (page.tsx와 동일 로직) */}"
auctions_modal = auctions_content[auctions_content.find(modal_start_token):]
auctions_modal = auctions_modal.rsplit(");", 1)[0].strip()

# replace formatMoney with formatPrice inside auctions_modal
auctions_modal = auctions_modal.replace("formatMoney", "formatPrice")

# page.tsx uses selectedAuction to open modal, but auctions/page.tsx uses selectedDetail.
# In auctions/page.tsx modal, it checks `{selectedDetail && (`.
# So I should change `page.tsx`'s `handleSelectAuction` to not use `selectedAuction` and use `selectedDetail` immediately like auctions.

new_handle = """  const handleSelectAuction = async (item: AuctionItem) => {
    setSelectedDetail({ ...item, ai_report_json: "{}" } as AuctionDetail);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/auctions/${item.case_number}`, { headers: { "ngrok-skip-browser-warning": "1" } });
      if (res.ok) {
        const data = await res.json();
        setSelectedDetail(data.data);
      }
    } catch (error) {
      console.error("상세 데이터 로딩 실패:", error);
    } finally {
      setDetailLoading(false);
    }
  };"""

page_content = re.sub(r"const handleSelectAuction = async.*?finally \{\s*setDetailLoading\(false\);\s*\}\s*\};", new_handle, page_content, flags=re.DOTALL)

# replace modal
page_modal_start = "{/* 3. 모달 (Modal) UI */}"
page_modal_idx = page_content.find(page_modal_start)
new_page_content = page_content[:page_modal_idx] + auctions_modal + "\n    </div>\n  );\n}\n"

with open("frontend/src/app/page.tsx", "w") as f:
    f.write(new_page_content)

print("Patched!")
