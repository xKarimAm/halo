from sam_halo import best_face, name_pos, parse_boxes

# Shape from dev.meta.ai/docs/sam/reading-segmentation (one frame, two objects, confidence on).
OUT = ("<0f>0<|box;x1=10;y1=20;x2=30;y2=60;w=640;h=360;c=0.9|><|mask;x=0;y=0;data=2,2,!abc|>"
       "1<|box;x1=100;y1=40;x2=300;y2=320;w=640;h=360;c=0.8|>")


def test_largest_box_becomes_tile_relative_face_and_pill_sits_above_it():
    boxes = parse_boxes(OUT)
    assert [b["c"] for b in boxes] == [0.9, 0.8]
    box = best_face(boxes)
    assert box == [100 / 640, 40 / 360, 200 / 640, 280 / 360]
    assert name_pos(box, 640, 360) == (200.0, 34.0)
    assert best_face(parse_boxes("")) is None
