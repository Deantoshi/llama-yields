
import re

def main():
    with open('defi-llama-api.yaml', 'r') as f:
        lines = f.readlines()

    header = []
    paths_start_index = -1
    
    # Find start of paths
    for i, line in enumerate(lines):
        if line.startswith('paths:'):
            paths_start_index = i
            break
        header.append(line)
    
    if paths_start_index == -1:
        print("Error: Could not find 'paths:' section.")
        return

    paths_lines = lines[paths_start_index+1:]
    
    # Process header to split tags
    header_str = "".join(header)
    
    # Simple regex to find the tags block and iterate its items
    # We assume tags block is strictly formatted as in the file
    tags_block_match = re.search(r'^tags:\n', header_str, re.MULTILINE)
    
    tvl_yield_tags_content = []
    other_tags_content = []
    
    new_header_lines = []
    in_tags_block = False
    
    # Re-process header lines to split tags
    i = 0
    while i < len(header):
        line = header[i]
        if line.startswith('tags:'):
            in_tags_block = True
            new_header_lines.append(line)
            i += 1
            continue
        
        if in_tags_block:
            if line.startswith('  - name:'):
                # Start of a tag definition
                tag_lines = [line]
                i += 1
                while i < len(header) and not header[i].startswith('  - name:') and header[i].startswith('    '):
                     tag_lines.append(header[i])
                     i += 1
                
                # Check which tag this is
                tag_name_match = re.search(r'name: (.*)', tag_lines[0])
                if tag_name_match:
                    tag_name = tag_name_match.group(1).strip()
                    if tag_name in ['TVL', 'yields']:
                        tvl_yield_tags_content.extend(tag_lines)
                    else:
                        other_tags_content.extend(tag_lines)
                else:
                    # Should not happen given structure
                    other_tags_content.extend(tag_lines)
                continue
            elif line.startswith('servers:') or (line[0].isalpha() and line.strip() != ''):
                # End of tags block
                in_tags_block = False
                new_header_lines.append(line)
                i += 1
                continue
            else:
                 # Empty lines or comments inside tags?
                 if line.strip() == '':
                     # Keep empty lines?
                     pass
                 new_header_lines.append(line)
                 i += 1
                 continue
        else:
            new_header_lines.append(line)
            i += 1

    # Construct headers for both files
    # Original file header (minus TVL/yield tags)
    # We need to reconstruct it properly.
    
    # Let's do a simpler approach for header: 
    # Just copy the common parts and inject the specific tags.
    
    # Find where 'tags:' starts in header lines
    tags_start_idx = -1
    tags_end_idx = -1
    for idx, line in enumerate(header):
        if line.startswith('tags:'):
            tags_start_idx = idx
            break
            
    if tags_start_idx != -1:
        # Find end of tags (next top level key)
        for idx in range(tags_start_idx + 1, len(header)):
            if header[idx] and header[idx][0].isalpha() and ':' in header[idx]:
                tags_end_idx = idx
                break
        if tags_end_idx == -1:
            tags_end_idx = len(header)
            
    # Function to build header with specific tags
    def build_header(tags_lines):
        h = header[:tags_start_idx+1] # Includes 'tags:'
        h.extend(tags_lines)
        h.extend(header[tags_end_idx:])
        return h

    header_original = build_header(other_tags_content)
    header_new = build_header(tvl_yield_tags_content)

    # Process paths
    kept_paths = []
    moved_paths = []
    
    current_path_lines = []
    current_path_is_target = False
    
    # Helper to parse paths
    # A path block starts with "  /." and ends before the next "  /."
    
    path_start_pattern = re.compile(r'^  /')
    
    current_path_block = []
    
    for line in paths_lines:
        if path_start_pattern.match(line):
            # Process previous block
            if current_path_block:
                block_str = "".join(current_path_block)
                # Check for tags
                if "        - TVL" in block_str or "        - yields" in block_str:
                    moved_paths.extend(current_path_block)
                else:
                    kept_paths.extend(current_path_block)
            
            # Start new block
            current_path_block = [line]
        else:
            current_path_block.append(line)
            
    # Process last block
    if current_path_block:
        block_str = "".join(current_path_block)
        if "        - TVL" in block_str or "        - yields" in block_str:
            moved_paths.extend(current_path_block)
        else:
            kept_paths.extend(current_path_block)

    # Write new files
    with open('api-tvl-and-yield.yaml', 'w') as f:
        f.writelines(header_new)
        f.write("paths:\n")
        f.writelines(moved_paths)
        
    with open('defi-llama-api.yaml', 'w') as f:
        f.writelines(header_original)
        f.write("paths:\n")
        f.writelines(kept_paths)

if __name__ == "__main__":
    main()
