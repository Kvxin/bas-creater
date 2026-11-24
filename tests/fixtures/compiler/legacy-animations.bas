def text obj_c1 {
    content = "legacy"
    duration = 4s
}
set obj_c1 { x = 100 } 1s
then set obj_c1 {} 0.25s
then set obj_c1 { alpha = 0 } 0.5s
set obj_c1 {} 2s
then set obj_c1 { scale = 2 } 0.8s
