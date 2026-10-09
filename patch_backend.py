import re

with open("backend/main.py", "r") as f:
    content = f.read()

# Replace the signature
old_sig = """def get_auctions(
    limit: int = 20, 
    offset: int = 0,
    grade: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    sort: Optional[str] = 'recent'
):"""

new_sig = """def get_auctions(
    limit: int = 20, 
    offset: int = 0,
    grade: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    sort: Optional[str] = 'recent',
    property_type: Optional[str] = None,
    region: Optional[str] = None
):"""

content = content.replace(old_sig, new_sig)

# Add the filter logic
filter_logic = """
        if property_type:
            if property_type == 'apartment':
                query += " AND location LIKE '%아파트%'"
            elif property_type == 'officetel':
                query += " AND location LIKE '%오피스텔%'"
            elif property_type == 'villa':
                query += " AND (location LIKE '%다세대%' OR location LIKE '%빌라%')"
            elif property_type == 'commercial':
                query += " AND (location LIKE '%상가%' OR location LIKE '%근린%')"
            elif property_type == 'land':
                query += " AND (location LIKE '%임야%' OR location LIKE '%산 %' OR location LIKE '%번지%')"
                
        if region:
            query += " AND location LIKE ?"
            params.append(f"%{region}%")
"""

# Insert right before `# Sorting`
content = content.replace("        # Sorting", filter_logic + "\n        # Sorting")

with open("backend/main.py", "w") as f:
    f.write(content)

print("Backend patched")
