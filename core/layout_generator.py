import ezdxf


class LayoutGenerator:
    def __init__(self):
        pass

    def generate_dxf(self, bounding_boxes, image_dims, output_path):
        """
        Generates a DXF file based on facade elements.
        Args:
            bounding_boxes: List of (label, x, y, w, h)
            image_dims: (width, height)
            output_path: Path to save .dxf
        """
        doc = ezdxf.new()
        msp = doc.modelspace()

        # Layers
        doc.layers.new(name="WALL", dxfattribs={"color": 7})  # White
        doc.layers.new(name="WINDOW", dxfattribs={"color": 4})  # Cyan
        doc.layers.new(name="DOOR", dxfattribs={"color": 1})  # Red

        # Dimensions & Scaling
        # Assuming 1 pixel = 10mm for schematic purposes
        scale = 10
        depth = 12000  # 12 meters deep

        img_w, img_h = image_dims

        # Identify building bounds
        xs = [b[1] for b in bounding_boxes]
        xws = [b[1] + b[3] for b in bounding_boxes]

        if not xs:
            min_x, max_x = 0, img_w
        else:
            min_x = min(xs)
            max_x = max(xws)

        width_mm = (max_x - min_x) * scale

        # 1. Draw External Walls (Box)
        # Origin (0,0) is top-left of building layout
        # (0,0) -> (W,0) -> (W, Depth) -> (0, Depth) -> (0,0)

        msp.add_lwpolyline(
            [(0, 0), (width_mm, 0), (width_mm, depth), (0, depth), (0, 0)],
            dxfattribs={"layer": "WALL", "closed": True},
        )

        # 2. Draw Corridor (Mid-depth)
        msp.add_line(
            (0, depth / 2), (width_mm, depth / 2), dxfattribs={"layer": "WALL"}
        )

        # 3. Draw Partitions (Between windows)
        # Sort windows by X to find bays
        windows = sorted(
            [b for b in bounding_boxes if b[0] == "window"], key=lambda x: x[1]
        )

        # Find unique "columns" of windows (approximate x-centers)
        if windows:
            current_cluster = [windows[0]]
            for w in windows[1:]:
                # If x-center is close to previous, group them
                prev_xc = current_cluster[-1][1] + current_cluster[-1][3] / 2
                curr_xc = w[1] + w[3] / 2

                if abs(curr_xc - prev_xc) < (w[3]):  # If within a window width
                    current_cluster.append(w)
                else:
                    # New column
                    # Calculate partition line X (midpoint between last cluster and this one)
                    prev_max_x = max([b[1] + b[3] for b in current_cluster])
                    curr_min_x = w[1]

                    partition_x_px = (prev_max_x + curr_min_x) / 2
                    partition_x_mm = (partition_x_px - min_x) * scale

                    # Draw partition
                    msp.add_line(
                        (partition_x_mm, 0),
                        (partition_x_mm, depth / 2),
                        dxfattribs={"layer": "WALL"},
                    )

                    current_cluster = [w]

        # 4. Draw Windows/Doors on Facade Line (y=0)
        for b in bounding_boxes:
            label, x, y, w, h = b

            # Map x relative to building left
            start_x_mm = (x - min_x) * scale
            width_mm_elem = w * scale

            layer = "WINDOW" if label == "window" else "DOOR"

            # Draw rectangle representing element
            # Thickness 200mm
            msp.add_lwpolyline(
                [
                    (start_x_mm, -100),
                    (start_x_mm + width_mm_elem, -100),
                    (start_x_mm + width_mm_elem, 100),
                    (start_x_mm, 100),
                    (start_x_mm, -100),
                ],
                dxfattribs={"layer": layer, "closed": True},
            )

        doc.saveas(output_path)
        return output_path
