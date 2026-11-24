def text obj_c1 {
    content = "late"
    duration = 3.5s
    alpha = 0
}
set obj_c1 {} 1.5s
then set obj_c1 { alpha = 0.8 } 0s
